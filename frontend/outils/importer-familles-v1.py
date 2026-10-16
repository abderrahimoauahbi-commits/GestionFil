# -*- coding: utf-8 -*-
"""
Importe les FAMILLES DE COULEURS de la v1 (06/10/2026) dans le systeme des
styles (`data-charte`), sauf les deux familles en verre (« Glass Industrial »
et l'ancien « Verre liquide »), a la demande de la direction.

Source : `palettes.css` et `palette-laiton.css` du commit 9c25e24 (supprimes
le 03/10/2026). Les selecteurs de l'atelier (`.atelier[data-palette=x]`) sont
convertis en `:root[data-charte=x]` ; les selecteurs sans famille (la famille
par defaut d'alors) sont retires, pour ne pas ecraser les jetons de base.

Claude et Azur n'avaient que trois teintes et aucune feuille : leurs jetons
sont composes ici a partir de ces teintes.

Usage (depuis frontend/) :
    git show 9c25e24:frontend/src/composants/atelier/palettes.css > %TEMP%\\pal.css
    git show 9c25e24:frontend/src/composants/atelier/palette-laiton.css > %TEMP%\\laiton.css
    python outils/importer-familles-v1.py %TEMP%\\pal.css %TEMP%\\laiton.css
"""
import colorsys
import re
import sys
from pathlib import Path

SORTIE = Path(__file__).resolve().parent.parent / "src" / "styles" / "familles-v1.css"
EXCLUES = {"glassier", "verre"}


def regles(css):
    """Decoupe une feuille en regles de premier niveau (selecteurs, corps)."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    i, n, out = 0, len(css), []
    while i < n:
        j = css.find("{", i)
        if j < 0:
            break
        tete = css[i:j].strip()
        prof, k = 1, j + 1
        while k < n and prof:
            prof += {"{": 1, "}": -1}.get(css[k], 0)
            k += 1
        out.append((tete, css[j + 1:k - 1]))
        i = k
    return out


def convertir(css):
    lignes = []
    for tete, corps in regles(css):
        if tete.startswith("@"):
            continue  # @supports : propres aux familles en verre
        sels = [s.strip() for s in tete.split(",") if s.strip()]
        familles = set(re.findall(r'data-palette="([a-z]+)"', tete))
        if not familles or familles & EXCLUES:
            continue
        # Les versions .atelier portent le selecteur complet (descendants
        # compris) : on les ramene a :root ; les autres sont redondantes.
        atelier = [s for s in sels if s.startswith(".atelier") and "data-palette" in s]
        base = atelier or [s for s in sels if "data-palette" in s]
        nouveaux = []
        for s in base:
            s = s.replace(".atelier", ":root", 1).replace('data-palette="', "data-charte=\"")
            if s not in nouveaux:
                nouveaux.append(s)
        lignes.append(",\n".join(nouveaux) + " {" + corps.rstrip() + "\n}\n")
    return "\n".join(lignes)


def hsl(h):
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))
    hh, l, s = colorsys.rgb_to_hls(r, g, b)
    return f"{round(hh * 360)} {round(s * 100, 1):g}% {round(l * 100, 1):g}%"


def jetons(cle, clair, sombre):
    def bloc(sel, d, schema):
        return sel + " {\n" + "\n".join(f"  --{k}: {hsl(v)};" for k, v in d.items()) + f"\n  color-scheme: {schema};\n}}\n"
    return bloc(f':root[data-charte="{cle}"]', clair, "light") + bloc(f':root.sombre[data-charte="{cle}"]', sombre, "dark")


CLAUDE = (
    {"fond": "#F5F4EE", "texte": "#2B2823", "surface": "#FBFAF6", "surface-texte": "#2B2823", "attenue": "#ECEAE0",
     "attenue-texte": "#6B655A", "accent": "#2B2823", "accent-texte": "#FBFAF6", "primaire": "#C2603E", "primaire-texte": "#FFFFFF",
     "or": "#A07A2C", "danger": "#B3261E", "danger-texte": "#FFFFFF", "succes": "#2F7D4F", "alerte": "#B4630B", "info": "#3A6EA5",
     "bordure": "#DDD9CC", "ligne": "#E7E4D9", "champ": "#BDB8A8", "anneau": "#D97757",
     "barre": "#2B2823", "barre-texte": "#F5F4EE", "barre-attenue": "#B9B2A3", "barre-actif": "#3A3630"},
    {"fond": "#1F1D1A", "texte": "#EDEAE2", "surface": "#272420", "surface-texte": "#EDEAE2", "attenue": "#2F2C27",
     "attenue-texte": "#A9A293", "accent": "#EDEAE2", "accent-texte": "#1F1D1A", "primaire": "#E08A6B", "primaire-texte": "#1F1D1A",
     "or": "#D3B06A", "danger": "#F2857A", "danger-texte": "#1F1D1A", "succes": "#6FCF97", "alerte": "#F0B35A", "info": "#8AB4E8",
     "bordure": "#3A3630", "ligne": "#302D28", "champ": "#4A453D", "anneau": "#E08A6B",
     "barre": "#171512", "barre-texte": "#EDEAE2", "barre-attenue": "#A9A293", "barre-actif": "#2F2C27"},
)
AZUR = (
    {"fond": "#F8F9FA", "texte": "#202124", "surface": "#FFFFFF", "surface-texte": "#202124", "attenue": "#F1F3F4",
     "attenue-texte": "#5F6368", "accent": "#1A73E8", "accent-texte": "#FFFFFF", "primaire": "#1A73E8", "primaire-texte": "#FFFFFF",
     "or": "#A07A2C", "danger": "#C5221F", "danger-texte": "#FFFFFF", "succes": "#188038", "alerte": "#B06000", "info": "#1A73E8",
     "bordure": "#DADCE0", "ligne": "#E8EAED", "champ": "#BDC1C6", "anneau": "#1A73E8",
     "barre": "#FFFFFF", "barre-texte": "#202124", "barre-attenue": "#5F6368", "barre-actif": "#E8F0FE"},
    {"fond": "#202124", "texte": "#E8EAED", "surface": "#292A2D", "surface-texte": "#E8EAED", "attenue": "#303134",
     "attenue-texte": "#9AA0A6", "accent": "#8AB4F8", "accent-texte": "#202124", "primaire": "#8AB4F8", "primaire-texte": "#202124",
     "or": "#D3B06A", "danger": "#F28B82", "danger-texte": "#202124", "succes": "#81C995", "alerte": "#FDD663", "info": "#8AB4F8",
     "bordure": "#3C4043", "ligne": "#303134", "champ": "#5F6368", "anneau": "#8AB4F8",
     "barre": "#1B1C1F", "barre-texte": "#E8EAED", "barre-attenue": "#9AA0A6", "barre-actif": "#303134"},
)

if __name__ == "__main__":
    css = "".join(Path(p).read_text(encoding="utf-8") for p in sys.argv[1:])
    sortie = (
        "/* =============================================================================\n"
        "   LES FAMILLES DE COULEURS DE LA V1 — importées le 06/10/2026\n"
        "   Fichier GÉNÉRÉ par outils/importer-familles-v1.py : ne pas éditer à la main.\n"
        "   Laiton, Industrial Clean, Atlas Data, Nordic Textile, Terminal Supply,\n"
        "   Ardoise, Graphite, Slate industriel, Divalto, Chaud, Contraste renforcé,\n"
        "   Claude, Azur. Les familles en verre de la v1 ne sont pas reprises.\n"
        "   Elles partagent le rendu du style Classique (voir chartes.css).\n"
        "   ========================================================================== */\n\n"
        + convertir(css)
        + "\n/* --- Claude et Azur : composés à partir de leurs trois teintes --- */\n"
        + jetons("claude", *CLAUDE)
        + jetons("azur", *AZUR)
    )
    SORTIE.write_text(sortie, encoding="utf-8")
    print("écrit", SORTIE, len(sortie.splitlines()), "lignes")
    print("familles :", sorted(set(re.findall(r'data-charte="([a-z]+)"', sortie))))
