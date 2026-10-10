# -*- coding: utf-8 -*-
"""
Rassemble les constats des tests de bout en bout (rapport-e2e/constats/*.json)
en un rapport lisible : rapport-e2e/constats.md, du plus grave au plus leger,
par type puis par ecran. Lance par lancer.py ; se relance seul :
    python e2e/constats.py
"""
import json
from collections import defaultdict
from pathlib import Path

ICI = Path(__file__).resolve().parent
RAPPORT = ICI.parent / "rapport-e2e"
ORDRE = {"bloquant": 0, "genant": 1, "mineur": 2}
LIBELLES = {
    "bouton-hors-ecran": "Bouton sorti de l'écran (inaccessible sans défiler à droite)",
    "action-hors-ecran": "Action nécessaire hors de l'écran (il faut défiler le tableau pour la trouver)",
    "nombre-mal-lu": "Nombre tapé mal lu",
    "champ-obligatoire-introuvable": "Champ obligatoire manquant non désigné",
    "bouton-masque": "Bouton recouvert par un autre élément",
    "action-sous-l-ecran": "Action principale sous le bas de l'écran (il faut défiler pour la trouver)",
    "page-defile-horizontalement": "La page entière défile horizontalement",
    "tableau-defile-horizontalement": "Tableau plus large que son cadre (défilement horizontal)",
    "tableau-tres-long": "Tableau très long (plusieurs écrans de défilement vertical)",
    "champ-trop-etroit": "Champ trop étroit pour sa valeur",
    "cellules-tronquees": "Cellules de tableau coupées",
    "api-refus": "Le serveur refuse une requête de l'écran (4xx)",
    "console-avertissement": "Avertissement dans la console",
    "html-id-double": "HTML : identifiant en double",
}


def main():
    fichiers = sorted((RAPPORT / "constats").glob("*.json"))
    if not fichiers:
        print("aucun constat (les tests ont-ils tourne ?)")
        return
    par_type = defaultdict(list)
    ecrans = set()
    for f in fichiers:
        d = json.loads(f.read_text(encoding="utf-8"))
        ecrans.add(d["ecran"])
        for c in d["constats"]:
            par_type[(c["gravite"], c["type"])].append((d["ecran"], d["taille"], c))
    lignes = [
        "# Constats des tests de bout en bout",
        "",
        f"{len(ecrans)} écrans ouverts dans Edge, en 1366×768 et 1920×1080. "
        "Un constat ne fait pas échouer le test : c'est ce qu'un utilisateur verrait de travers.",
        "",
        "| Gravité | Constat | Écrans touchés | Occurrences |",
        "|---|---|---|---|",
    ]
    cles = sorted(par_type, key=lambda k: (ORDRE.get(k[0], 9), -len(par_type[k])))
    for g, t in cles:
        occ = par_type[(g, t)]
        lignes.append(f"| {g} | {LIBELLES.get(t, t)} | {len({e for e, _, _ in occ})} | {len(occ)} |")
    for g, t in cles:
        lignes += ["", f"## {g} — {LIBELLES.get(t, t)}", ""]
        vus = set()
        for ecran, taille, c in sorted(par_type[(g, t)], key=lambda x: (x[0], x[1])):
            cle = (ecran, c.get("element"), c["detail"])
            if cle in vus:
                continue
            vus.add(cle)
            el = f" — {c['element']}" if c.get("element") else ""
            lignes.append(f"- `{ecran}` ({taille}){el} : {c['detail']}")
    (RAPPORT / "constats.md").write_text("\n".join(lignes) + "\n", encoding="utf-8")
    galerie(fichiers)
    print(f"rapport : {RAPPORT / 'constats.md'} ({sum(len(v) for v in par_type.values())} constats), "
          f"galerie : {RAPPORT / 'galerie.html'}")


def galerie(fichiers):
    """Une page locale : chaque ecran, sa capture par taille d'ecran, ses constats dessous."""
    from html import escape
    par_ecran = defaultdict(dict)
    for f in fichiers:
        d = json.loads(f.read_text(encoding="utf-8"))
        par_ecran[d["ecran"]][d["taille"]] = d
    couleurs = {"bloquant": "#b42318", "genant": "#b54708", "mineur": "#667085"}
    blocs = []
    for ecran in sorted(par_ecran):
        colonnes = []
        for taille in sorted(par_ecran[ecran]):
            d = par_ecran[ecran][taille]
            img = ""
            if d.get("capture") and Path(d["capture"]).exists():
                rel = Path(d["capture"]).resolve().relative_to(RAPPORT.resolve()).as_posix()
                img = f'<a href="{escape(rel)}" target="_blank"><img src="{escape(rel)}" loading="lazy"></a>'
            vus, items = set(), []
            for c in sorted(d["constats"], key=lambda c: ORDRE.get(c["gravite"], 9)):
                cle = (c["type"], c.get("element"), c["detail"])
                if cle in vus:
                    continue
                vus.add(cle)
                el = f" — {escape(c['element'])}" if c.get("element") else ""
                items.append(f'<li><b style="color:{couleurs.get(c["gravite"], "#333")}">{escape(c["gravite"])}</b> '
                             f'{escape(LIBELLES.get(c["type"], c["type"]))}{el} : {escape(c["detail"])}</li>')
            colonnes.append(f'<div class="col"><h3>{escape(taille)} · {len(items)} constat(s)</h3>{img}'
                            f'<ul>{"".join(items) or "<li>aucun constat</li>"}</ul></div>')
        blocs.append(f'<section><h2>{escape(ecran)}</h2><div class="cols">{"".join(colonnes)}</div></section>')
    page = f"""<!doctype html><html lang="fr"><meta charset="utf-8"><title>Captures des écrans</title>
<style>body{{font:14px system-ui,sans-serif;margin:16px;background:#f2f4f7;color:#1d2939}}
section{{background:#fff;border-radius:8px;padding:12px 16px;margin:0 0 16px}}h2{{margin:0 0 8px;font-size:16px}}
h3{{margin:4px 0;font-size:13px;color:#475467}}.cols{{display:flex;gap:16px;flex-wrap:wrap}}.col{{flex:1 1 480px;min-width:0}}
img{{width:100%;border:1px solid #d0d5dd;border-radius:4px}}ul{{margin:6px 0;padding-left:18px}}li{{margin:2px 0}}</style>
<h1>Captures des écrans — tests de bout en bout</h1>
<p>{len(par_ecran)} écrans. Cliquer une capture pour l'ouvrir en grand.</p>
{"".join(blocs)}</html>"""
    (RAPPORT / "galerie.html").write_text(page, encoding="utf-8")


if __name__ == "__main__":
    main()
