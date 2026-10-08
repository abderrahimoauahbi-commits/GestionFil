# -*- coding: utf-8 -*-
"""
Fabrique le fond du style « verre liquide » : des ONDES DE POINTS RELIÉS.

Le modèle est l'image de référence donnée par la direction (« contexte de la
technologie des ondes abstraites, structure de connexion ») : sur un bleu nuit
presque noir, des nappes ondulées faites de points lumineux reliés par des fils
fins, cyan vers bleu vers violet, plus nettes au premier plan, floues au loin.

TROIS PLANS : une nappe lointaine large et floue, une nappe médiane, une nappe
proche nette et lumineuse. Puis halo (flou additif), vignettage et grain.

Fabriqué ici plutôt que téléchargé : l'application tourne sur le réseau local,
sans internet, et une image sous licence ne se redistribue pas.

Usage :
    python outils/fabriquer-fond-ondes.py
"""
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

L, H = 2400, 1350
SORTIE = Path(__file__).resolve().parent.parent / "public" / "fond-ondes.jpg"  # et fond-ondes-clair.jpg
rng = np.random.default_rng(7)

CYAN = np.array([34, 211, 238], np.float32)
BLEU = np.array([59, 130, 246], np.float32)
VIOLET = np.array([139, 92, 246], np.float32)


def teinte(t):
    """Cyan à gauche, bleu au centre, violet à droite."""
    t = min(max(t, 0.0), 1.0)
    if t < 0.5:
        return CYAN + (BLEU - CYAN) * (t / 0.5)
    return BLEU + (VIOLET - BLEU) * ((t - 0.5) / 0.5)


def fond():
    Y, X = np.mgrid[0:H, 0:L].astype(np.float32)
    haut = np.array([4, 6, 14], np.float32)
    bas = np.array([8, 16, 40], np.float32)
    t = (Y / H)[..., None]
    img = haut * (1 - t) + bas * t
    # Une lumière bleue diffuse derrière les ondes, un peu sous le centre.
    d = np.sqrt(((X - L * 0.55) / (L * 0.55)) ** 2 + ((Y - H * 0.58) / (H * 0.45)) ** 2)
    img += np.array([10, 30, 70], np.float32) * np.clip(1 - d, 0, 1)[..., None] ** 1.6
    return img


def nappe(couche, rangs, colonnes, centre_y, amplitude, ecart, phase, epaisseur, rayon, force):
    """Une nappe d'ondes : `rangs` lignes de points, chacune décalée en phase."""
    calque = Image.new("RGB", (L, H), (0, 0, 0))
    dessin = ImageDraw.Draw(calque)
    for r in range(rangs):
        v = r / max(rangs - 1, 1)
        points = []
        for c in range(colonnes):
            u = c / (colonnes - 1)
            x = -0.05 * L + u * 1.10 * L
            # deux sinus superposés + une enveloppe qui gonfle au centre
            env = 0.55 + 0.45 * math.sin(math.pi * u)
            y = (centre_y + (v - 0.5) * ecart
                 + amplitude * env * math.sin(2.1 * math.pi * u + phase + v * 1.9)
                 + amplitude * 0.35 * math.sin(5.3 * math.pi * u - phase * 0.7 + v * 3.1))
            points.append((x, y, u))
        lum = force * (0.35 + 0.65 * math.sin(math.pi * v))
        # les fils le long du rang
        for (x0, y0, u0), (x1, y1, _) in zip(points, points[1:]):
            col = tuple(int(k * lum * 0.55) for k in teinte(u0))
            dessin.line([(x0, y0), (x1, y1)], fill=col, width=epaisseur)
        # les points, plus lumineux, un sur deux plus gros
        for i, (x, y, u) in enumerate(points):
            col = tuple(int(min(255, k * lum * 1.25)) for k in teinte(u))
            rr = rayon * (1.6 if (i + r) % 5 == 0 else 1.0)
            dessin.ellipse([x - rr, y - rr, x + rr, y + rr], fill=col)
    # quelques liens obliques entre rangs voisins : la « structure de connexion »
    return np.asarray(calque, np.float32)


def poussiere(n, force):
    calque = Image.new("RGB", (L, H), (0, 0, 0))
    d = ImageDraw.Draw(calque)
    for _ in range(n):
        x, y = rng.uniform(0, L), rng.uniform(0, H)
        rr = rng.uniform(0.6, 1.8)
        col = tuple(int(k * force * rng.uniform(0.3, 1.0)) for k in teinte(x / L))
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=col)
    return np.asarray(calque, np.float32)


def flou(arr, rayon):
    return np.asarray(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(rayon)), np.float32)


# --- La lumière des ondes, sur noir : elle sert aux deux versions ------------
lumiere = np.zeros((H, L, 3), np.float32)

# 1. nappe lointaine : large, floue (profondeur)
loin = nappe(None, 26, 90, H * 0.40, H * 0.10, H * 0.30, 0.6, 2, 2.2, 0.55)
lumiere += flou(loin, 6) * 0.9

# 2. nappe médiane
milieu = nappe(None, 34, 120, H * 0.56, H * 0.13, H * 0.34, 1.7, 1, 1.8, 0.85)
lumiere += flou(milieu, 1.2) + flou(milieu, 10) * 0.6

# 3. nappe proche : nette et lumineuse, avec halo
proche = nappe(None, 22, 150, H * 0.70, H * 0.16, H * 0.26, 2.9, 1, 2.0, 1.0)
lumiere += proche + flou(proche, 14) * 0.9 + flou(proche, 40) * 0.5

# poussière lumineuse
lumiere += flou(poussiere(900, 0.7), 0.8)

Y, X = np.mgrid[0:H, 0:L].astype(np.float32)
d = np.sqrt(((X - L / 2) / (L / 2)) ** 2 + ((Y - H / 2) / (H / 2)) ** 2)


def ecrire(img, nom):
    img = img + rng.normal(0, 2.2, img.shape[:2])[..., None]   # grain fin
    chemin = SORTIE.with_name(nom)
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).resize((1920, 1080), Image.LANCZOS).save(
        chemin, quality=86, optimize=True, progressive=True)
    print("écrit", chemin)


# --- Version SOMBRE : la lumière s'ajoute au bleu nuit, puis vignettage -------
sombre = fond() + lumiere
sombre *= np.clip(1.15 - 0.55 * d ** 2, 0.25, 1)[..., None]
ecrire(sombre, "fond-ondes.jpg")

# --- Version CLAIRE : les ondes deviennent de l'ENCRE sur un papier bleuté ----
# On ne peut pas « ajouter » de la lumière sur du blanc : l'intensité de la
# lumière devient l'opacité d'une encre bleue, plus soutenue que la teinte.
t = (Y / H)[..., None]
papier = np.array([246, 248, 253], np.float32) * (1 - t) + np.array([232, 238, 250], np.float32) * t
intensite = np.clip(lumiere.max(axis=2, keepdims=True) / 255.0, 0, 1)
encre = np.clip(lumiere / np.maximum(lumiere.max(axis=2, keepdims=True), 1) * 255 * 0.78, 0, 255)
clair = papier * (1 - intensite * 0.85) + encre * (intensite * 0.85)
clair = 255 - (255 - clair) * np.clip(1.05 - 0.25 * d ** 2, 0.7, 1)[..., None]   # vignettage doux
ecrire(clair, "fond-ondes-clair.jpg")
