# -*- coding: utf-8 -*-
"""
Tire docs/matrice-mouvements.md de backend/tests/banc/matrice_mouvements.json.

La matrice est un artefact CONTROLE : le banc (scenario matrice_mouvements)
verifie que le fichier dit la meme chose que la base (signe, effet sur le CMUP,
exigences) et que les scenarios qu'il cite existent. Le document, lui, n'est
que sa mise en page : le regenerer apres toute modification du fichier.

    python db/pg/matrice.py
"""
import json
from pathlib import Path

RACINE = Path(__file__).resolve().parents[2]
SOURCE = RACINE / "backend" / "tests" / "banc" / "matrice_mouvements.json"
CIBLE = RACINE / "docs" / "matrice-mouvements.md"

GROUPES = [
    ("Achats", ["ENTREE_REC", "RETOUR_FOURN", "STOCK_INIT"]),
    ("Production et sorties", ["SORTIE_PROD", "RETOUR_PROD", "SORTIE_HORS_MACHINE", "RETOUR_PRET"]),
    ("Inventaire et corrections", ["AJUST_INV_POS", "AJUST_INV_NEG"]),
    ("Transferts (le fil en route entre les deux)", ["TRANSFERT_SORTIE", "TRANSFERT_ENTREE"]),
    ("Lots", ["FUSION_SORTIE", "FUSION_ENTREE"]),
    ("Machines", ["CHARGE_MACHINE", "RETOUR_MACHINE", "ANNUL_CHARGE_MACHINE", "ANNUL_RETOUR_MACHINE"]),
]


def main():
    types = json.loads(SOURCE.read_text(encoding="utf-8"))["types"]
    ranges = [c for _, codes in GROUPES for c in codes]
    oublies = sorted(set(types) - set(ranges))
    assert not oublies, f"types sans groupe dans matrice.py : {oublies}"
    l = [
        "# Matrice des mouvements de stock",
        "",
        "> Généré par `python db/pg/matrice.py` depuis `backend/tests/banc/matrice_mouvements.json`.",
        "> Ne pas éditer à la main : le banc (`matrice_mouvements`) vérifie le fichier source contre la base.",
        "",
        "**Règles communes.** Le kilogramme est l'unité ; le stock d'un magasin ne passe jamais sous zéro (R02) ;",
        "le grand livre (`ligne_mouvement`) est immuable et fait foi, `stock_magasin` n'en est que le cache (C11) ;",
        "le stock par lot suit quand la ligne porte un lot. Seule une ENTRÉE valorisée touche le CMUP",
        "(contrainte `type_mouvement_cmup_entree`) ; chaque sortie porte son coût, le CMUP du moment (10/10/2026).",
        "Le fil en route (transfert expédié, pas encore reçu) compte dans la valeur du stock et dans le calcul",
        "des besoins, pour son magasin de destination.",
        "",
        "| Type | Sens | CMUP | Coût porté par la ligne | Exige | Réversibilité |",
        "|---|---|---|---|---|---|",
    ]
    for _, codes in GROUPES:
        for code in codes:
            t = types[code]
            exige = ", ".join(n for n, k in (("prix", "exige_prix"), ("OF", "exige_of"), ("motif de ligne", "exige_motif_ligne")) if t[k]) or "—"
            sens = ("+" if t["signe"] == 1 else "−") + (" (interne)" if t["interne"] else "")
            l.append(f"| `{code}` | {sens} | {t['cmup']} | {t['cout']} | {exige} | {t['reversibilite']} |")
    for titre, codes in GROUPES:
        l += ["", f"## {titre}", ""]
        for code in codes:
            t = types[code]
            l += [
                f"### `{code}`",
                "",
                f"- **Origine** : {t['origine']}",
                f"- **Sens** : {'entrée (+)' if t['signe'] == 1 else 'sortie (−)'} dans le magasin du mouvement ; le stock du lot suit",
                f"- **CMUP** : {t['cmup']}",
                f"- **Coût de la ligne** : {t['cout']}",
                f"- **Validation** : {t['validation']}",
                f"- **Réversibilité** : {t['reversibilite']}",
                f"- **Prouvé par le banc** : {', '.join(f'`{s}`' for s in t['banc'])}",
                "",
            ]
    CIBLE.write_text("\n".join(l).rstrip() + "\n", encoding="utf-8")
    print(f"{CIBLE.relative_to(RACINE)} : {len(types)} types de mouvement")


if __name__ == "__main__":
    main()
