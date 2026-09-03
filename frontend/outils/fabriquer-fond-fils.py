# -*- coding: utf-8 -*-
"""
Fabrique le fond de l'ecran de connexion : des FILS DE LUMIERE.

POURQUOI DES FILS. Le logiciel s'appelle Gestion Fil et gere des fils, des
bobines, des palettes de matiere premiere : des rubans souples qui traversent
l'ecran disent cela sans un mot, la ou un tapis geometrique faisait « motif de
papier peint » et un degrade ne disait rien. C'est aussi le langage visuel des
ecrans de connexion modernes : des formes fluides, floues par endroits comme
sous un objectif, sur un fond profond et calme.

TROIS PLANS, comme une photographie :
  1. LE FOND, un degrade diagonal graphite avec une lumiere douce en haut a
     droite ;
  2. LES FILS LOINTAINS, larges et tres flous : ils donnent la profondeur ;
  3. LES FILS PROCHES, fins et nets, dont deux en or ancien : ils accrochent
     le regard.
Puis vignettage et grain, comme sur toute image finie.

LE FIL EST UNE COURBE, PAS UNE DROITE : deux sinus superposes de periodes
differentes, une legere pente. Un seul sinus fait ressort ; deux font ruban.

Usage :
    python outils/fabriquer-fond-fils.py
"""
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

LARGEUR, HAUTEUR = 1920, 1080
SORTIE = Path(__file__).resolve().parent.parent / "public"
Y, X = np.mgrid[0:HAUTEUR, 0:LARGEUR].astype(np.float32)


def fond(haut, bas, lumiere, force_lumiere):
    t = (X / LARGEUR * 0.4 + Y / HAUTEUR * 0.6)[..., None]
    img = np.array(haut, np.float32) * (1 - t) + np.array(bas, np.float32) * t
    # Une lumiere douce, hors champ en haut a droite : c'est elle qui rend le
    # fond vivant sans le rendre clair.
    # UNE LUEUR, PAS UN PROJECTEUR. La premiere version, a 46 niveaux sur un
    # rayon d'un demi-ecran, saturait en blanc pur et la carte de verre posee
    # dessus devenait illisible : vu a la capture. Le halo est donc borne,
    # etroit et faible — il se devine, il ne s'impose pas.
    d = np.sqrt(((X - LARGEUR * 0.86) / (LARGEUR * 0.42)) ** 2
                + ((Y - HAUTEUR * 0.06) / (HAUTEUR * 0.62)) ** 2)
    halo = np.clip(1.0 - d, 0.0, 1.0) ** 2.6
    return img + halo[..., None] * np.array(lumiere, np.float32) * force_lumiere


def fil(img, y0, pente, ondes, epaisseur, couleur, alpha, flou=0.0, coeur=0.0):
    """Pose un ruban sur l'image.

    `ondes` : liste de (amplitude, periode, phase). `epaisseur` en pixels.
    `flou` : rayon du flou applique au masque — un fil lointain est flou.
    `coeur` : intensite d'un trait brillant au centre du ruban, pour les fils
    proches qui accrochent la lumiere.
    """
    yc = y0 + pente * (X - LARGEUR / 2)
    for amp, per, ph in ondes:
        yc = yc + amp * np.sin(2 * math.pi * X / per + ph)
    d = np.abs(Y - yc)
    masque = np.clip(1.0 - d / epaisseur, 0.0, 1.0)
    masque = masque * masque * (3 - 2 * masque)          # bords doux
    if coeur:
        masque = masque + coeur * np.exp(-((d / (epaisseur * 0.12)) ** 2))
    masque = np.clip(masque, 0.0, 1.0)
    if flou:
        m = Image.fromarray((masque * 255).astype(np.uint8))
        m = m.filter(ImageFilter.GaussianBlur(radius=flou))
        masque = np.asarray(m, np.float32) / 255.0
    couche = (masque * alpha)[..., None]
    return img * (1 - couche) + np.array(couleur, np.float32) * couche


def finir(t, vignettage, grain, graine):
    dx = (X - LARGEUR / 2) / (LARGEUR / 2)
    dy = (Y - HAUTEUR / 2) / (HAUTEUR / 2)
    d = np.sqrt(dx ** 2 + dy ** 2) / math.sqrt(2)
    t = t * (1.0 - vignettage * d ** 2)[..., None]
    rng = np.random.default_rng(graine)
    t = t + rng.normal(0.0, grain, t.shape)
    return Image.fromarray(np.clip(t, 0, 255).astype(np.uint8))


OR = (196, 161, 90)        # or ancien, mat : le meme que les filets de l'ecran
ACIER = (128, 142, 165)    # gris bleute, froid
PALE = (206, 210, 220)     # presque blanc
ARDOISE = (86, 104, 138)   # bleu-gris profond

VARIANTES = {
    # nom : (haut, bas, lumiere, force)
    "fond-fils-graphite.jpg": ((38, 41, 50), (17, 19, 25), (110, 118, 140), 0.55),
    "fond-fils-ardoise.jpg":  ((34, 42, 56), (14, 18, 27), (96, 122, 160), 0.6),
}

H = HAUTEUR
for i, (nom, (haut, bas, lum, force)) in enumerate(VARIANTES.items()):
    t = fond(haut, bas, lum, force)

    # --- Les fils lointains : larges, tres flous, discrets ---------------------
    t = fil(t, H * 0.30, 0.16, [(150, 1500, 0.4), (40, 620, 2.1)], 210, ARDOISE, 0.34, flou=48)
    t = fil(t, H * 0.72, -0.10, [(120, 1300, 1.9), (55, 700, 0.3)], 240, ACIER, 0.22, flou=60)
    t = fil(t, H * 0.55, 0.22, [(90, 1100, 3.4), (30, 480, 1.0)], 150, PALE, 0.08, flou=40)

    # --- Les fils moyens ---------------------------------------------------------
    t = fil(t, H * 0.40, 0.19, [(130, 1400, 1.2), (35, 560, 2.6)], 70, ACIER, 0.40, flou=10)
    t = fil(t, H * 0.64, 0.13, [(110, 1250, 2.8), (45, 650, 0.9)], 46, PALE, 0.20, flou=6)
    t = fil(t, H * 0.24, 0.12, [(100, 1600, 0.2), (25, 500, 1.7)], 58, ARDOISE, 0.42, flou=8)

    # --- Les fils proches : fins, nets, deux en or --------------------------------
    t = fil(t, H * 0.47, 0.18, [(125, 1380, 1.4), (32, 540, 2.4)], 14, PALE, 0.42, flou=1.2, coeur=0.7)
    t = fil(t, H * 0.58, 0.17, [(118, 1330, 1.55), (38, 590, 2.2)], 9, OR, 0.85, flou=0.8, coeur=1.2)
    t = fil(t, H * 0.35, 0.21, [(140, 1450, 0.9), (28, 470, 0.5)], 6, OR, 0.65, flou=0.6, coeur=1.0)
    t = fil(t, H * 0.80, 0.08, [(90, 1200, 3.0), (30, 520, 1.3)], 8, ACIER, 0.60, flou=0.8, coeur=0.8)

    img = finir(t, vignettage=0.38, grain=1.4, graine=21 + i)
    chemin = SORTIE / nom
    img.save(chemin, quality=90, optimize=True, progressive=True)
    print("  %-26s %4d Ko" % (nom, chemin.stat().st_size // 1024))
