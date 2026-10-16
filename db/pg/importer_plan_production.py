# -*- coding: utf-8 -*-
"""
IMPORT DIRECT DU PLAN DE PRODUCTION depuis le classeur « GESTION FIL » (10/10/2026).

La feuille Production_Plan porte une base mensuelle en m² par qualite, une
grille de saisonnalite 12 mois x qualite et une croissance annuelle : le modele
meme de plan_production / plan_qualite / plan_saisonnalite. Le script lit la
feuille (sans dependance : un .xlsx est un zip de XML) et enregistre le plan par
l'API du serveur — le meme chemin et les memes controles qu'une saisie a
l'ecran —, puis le passe en simulation, fige les recettes, le valide (en cours)
et calcule le MRP, pour que le plan d'achat le suive.

Le mois de depart n'est pas lu : la feuille est glissante, son M0 est le mois de
son dernier recalcul. Le plan part du mois courant ; la saisonnalite suit le
mois calendaire, le resultat est celui du classeur.

Usage :
    python db/pg/importer_plan_production.py --url http://127.0.0.1:8099 \\
        --classeur "C:/Users/.../GESTION FIL.xlsx" [--saisie Mohamed] [--valideur Choukri] [--a-blanc]
Mots de passe : variables SIM_MDP (les deux comptes) ou demandes a la console.
"""
import argparse
import datetime
import getpass
import html
import json
import os
import re
import sys
import unicodedata
import urllib.request
import zipfile

MOIS = ["janv", "fevr", "mars", "avri", "mai", "juin", "juil", "aout", "sept", "octo", "nove", "dece"]


def normaliser(s):
    s = unicodedata.normalize("NFKD", str(s).strip().lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def colonne(ref):
    n = 0
    for c in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + ord(c) - 64
    return n - 1


def lire_feuille(chemin, motif="production_plan"):
    z = zipfile.ZipFile(chemin)
    partages = []
    if "xl/sharedStrings.xml" in z.namelist():
        x = z.read("xl/sharedStrings.xml").decode("utf-8")
        for si in re.findall(r"<si>(.*?)</si>", x, re.S):
            partages.append(html.unescape("".join(re.findall(r"<t[^>]*>(.*?)</t>", si, re.S))))
    wb = z.read("xl/workbook.xml").decode("utf-8")
    rels = z.read("xl/_rels/workbook.xml.rels").decode("utf-8")
    cible = {}
    for rel in re.findall(r"<Relationship [^>]*/>", rels):
        i, t = re.search(r'Id="([^"]+)"', rel).group(1), re.search(r'Target="([^"]+)"', rel).group(1)
        cible[i] = "xl/" + t.lstrip("/").removeprefix("xl/")
    for m in re.finditer(r"<sheet [^>]*/>", wb):
        nom = html.unescape(re.search(r'name="([^"]+)"', m.group(0)).group(1))
        rid = re.search(r'r:id="([^"]+)"', m.group(0)).group(1)
        if motif in normaliser(nom).replace(" ", "_"):
            break
    else:
        sys.exit(f"{chemin} : pas de feuille Production_Plan")
    x = z.read(cible[rid]).decode("utf-8")
    lignes = []
    for _, contenu in re.findall(r'<row [^>]*r="(\d+)"[^>]*>(.*?)</row>', x, re.S):
        ligne = {}
        for c in re.finditer(r'<c r="([A-Z]+\d+)"([^>]*?)(?:/>|>(.*?)</c>)', contenu, re.S):
            ref, attrs, inner = c.group(1), c.group(2), c.group(3) or ""
            v = re.search(r"<v>(.*?)</v>", inner, re.S)
            t = re.search(r't="(\w+)"', attrs)
            if t and t.group(1) == "s" and v:
                val = partages[int(v.group(1))]
            elif t and t.group(1) == "inlineStr":
                val = html.unescape("".join(re.findall(r"<t[^>]*>(.*?)</t>", inner, re.S)))
            elif v:
                try:
                    val = float(v.group(1))
                except ValueError:
                    val = html.unescape(v.group(1))
            else:
                continue
            ligne[colonne(ref)] = val
        lignes.append(ligne)
    return nom, lignes


def analyser(lignes):
    croissance, bases, saisons = 0.0, [], []
    texte = lambda l, c: l.get(c) if isinstance(l.get(c), str) and l.get(c).strip() else None
    for i, l in enumerate(lignes):
        a = normaliser(texte(l, 0) or "")
        if a.startswith("croissance"):
            v = float(l.get(1) or 0)
            croissance = v * 100 if 0 < v < 1 else v  # une cellule au format % garde la fraction
        elif a == "mois" and not saisons:
            codes = {c: v.strip() for c, v in l.items() if c > 0 and isinstance(v, str) and v.strip()}
            for suite in lignes[i + 1:i + 13]:
                nom_mois = normaliser(texte(suite, 0) or "")
                m = next((k + 1 for k, p in enumerate(MOIS) if nom_mois.startswith(p)), None)
                if not m:
                    break
                for c, code in codes.items():
                    if isinstance(suite.get(c), float):
                        saisons.append({"code_qualite": code, "mois": m, "coefficient": suite[c]})
        elif a.startswith("qualite") and "base" in normaliser(texte(l, 1) or "") and not bases:
            for suite in lignes[i + 1:]:
                code = texte(suite, 0)
                if code is None:
                    continue
                if normaliser(code).startswith("total"):
                    break
                if isinstance(suite.get(1), float):
                    bases.append({"code_qualite": code.strip(), "m2_base_mensuel": suite[1]})
    if not bases:
        sys.exit("Feuille Production_Plan : tableau « Qualité | Base / mois » introuvable")
    return croissance, bases, saisons


class Api:
    def __init__(self, url, login, mdp):
        self.url = url.rstrip("/")
        self.jeton = self.appel("POST", "/api/auth/connexion", {"login": login, "mot_de_passe": mdp}, jeton=False)["jeton"]

    def appel(self, methode, chemin, corps=None, jeton=True):
        req = urllib.request.Request(self.url + chemin, method=methode,
                                     data=json.dumps(corps).encode() if corps is not None else None,
                                     headers={"Content-Type": "application/json"})
        if jeton:
            req.add_header("Authorization", f"Bearer {self.jeton}")
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                texte = r.read().decode("utf-8")
                return json.loads(texte) if texte else {}
        except urllib.error.HTTPError as e:
            sys.exit(f"{methode} {chemin} : {e.code} {e.read().decode('utf-8', 'replace')[:500]}")


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--url", default="http://127.0.0.1:8099")
    a.add_argument("--classeur", required=True)
    a.add_argument("--saisie", default="Mohamed")
    a.add_argument("--valideur", default="Choukri")
    a.add_argument("--a-blanc", action="store_true", help="lire et afficher, ne rien enregistrer")
    o = a.parse_args()

    feuille, lignes = lire_feuille(o.classeur)
    croissance, bases, saisons = analyser(lignes)
    mois = datetime.date.today().strftime("%Y-%m")
    total = sum(b["m2_base_mensuel"] for b in bases)
    print(f"{feuille} : {len(bases)} qualites, base {total:,.0f} m2/mois, {len(saisons)} coefficients, "
          f"croissance {croissance:g} %, depart {mois}")
    if o.a_blanc:
        for b in bases:
            print(f"  {b['code_qualite']:4} {b['m2_base_mensuel']:>10,.0f} m2/mois")
        return

    mdp = os.environ.get("SIM_MDP") or getpass.getpass(f"mot de passe de {o.saisie} : ")
    saisie = Api(o.url, o.saisie, mdp)
    valideur = Api(o.url, o.valideur, os.environ.get("SIM_MDP") or getpass.getpass(f"mot de passe de {o.valideur} : "))

    libelle = f"Plan de production {mois} (classeur GESTION FIL)"
    deja = [p for p in saisie.appel("GET", "/api/plans") if p.get("libelle") == libelle and p.get("statut") != "CLOTURE"]
    if deja:
        sys.exit(f"Le plan « {libelle} » existe deja ({deja[0]['statut']}) : rien n'est reimporte.")
    r = saisie.appel("PUT", "/api/plans", {
        "libelle": libelle, "scenario_nom": "Classeur", "date_debut": mois, "mois_horizon": 12,
        "croissance_annuelle_pct": croissance, "qualites": bases, "saisonnalite": saisons,
    })
    id_plan = r.get("id_plan")
    print(f"  enregistre : {id_plan}")
    saisie.appel("PUT", f"/api/plans/{id_plan}/statut", {"statut": "SIMULATION"})
    saisie.appel("POST", f"/api/plans/{id_plan}/figer-recettes", {})
    valideur.appel("PUT", f"/api/plans/{id_plan}/statut", {"statut": "EN_COURS"})
    print("  en simulation, recettes figees, valide (en cours)")
    mrp = valideur.appel("POST", f"/api/plans/{id_plan}/mrp", {})
    print(f"  MRP calcule : {json.dumps(mrp, ensure_ascii=False)[:300]}")


if __name__ == "__main__":
    main()
