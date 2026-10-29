# -*- coding: utf-8 -*-
"""
BANC DE CHARGE (audit D1-D3, 17/10/2026).

L'audit a laisse trois risques NON DEMONTRES, a mesurer plutot qu'a trancher par
raisonnement :

  D1  le pool de 16 connexions (acquire_timeout 10 s) suffit-il ?
  D2  des mouvements simultanes sur UNE MEME reference se gênent-ils (verrous,
      interblocages) ?
  D3  les 265 declencheurs coutent-ils cher a l'ecriture ?

Ce banc les mesure. Il reutilise l'infrastructure du banc metier : base JETABLE
batie depuis le socle, serveur d'essai sur un port a part, comptes d'essai. Il ne
touche ni `gestionfil` ni le serveur 8080.

Scenarios, joues a chaque palier de sessions simultanees :

  lecture            S6  lectures seules : liste des bons, lots d'une reference
  refs_differentes   S1  entree puis sortie, chaque session sur SA reference (D3)
  meme_ref           S2  entree puis sortie, toutes sur LA MEME reference (D2)
  lent_et_ecritures  S5  la moitie lit le cockpit (requete de plusieurs secondes,
                         qui tient une connexion), l'autre ecrit (D1)

et une fois, a part :

  survente           S3  N sorties lancees ENSEMBLE sur un stock qui n'en couvre
                         que la moitie : exactement la moitie doit passer, le stock
                         ne doit jamais devenir negatif, le grand livre doit rester
                         egal au cache (controle C11).

LES CHIFFRES SONT CEUX DE LA MACHINE QUI JOUE LE BANC. Serveur, base et clients y
tournent ensemble : c'est une borne basse, pas la mesure de la production.

Usage :
    python backend/tests/charge/charge.py --cible <CARGO_TARGET_DIR> [--paliers 1,5,10,25,50]
                                          [--duree 15] [--sortie resultats.json] [--garder]
PGPASSWORD = mot de passe postgres.
"""
import json
import math
import os
import statistics
import sys
import threading
import time
from pathlib import Path

ICI = Path(__file__).resolve().parent
sys.path.insert(0, str(ICI.parent / "banc"))
import banc  # noqa: E402  (Infra, Client, Echec)

PORT = 8095
MAG = "Morocco"
REF_COMMUNE = "PLA 100 CHE"
REF_SURVENTE = "PLA 50 CHE"
LOGIN = "Choukri"


# ---------------------------------------------------------------------------
# Appels
# ---------------------------------------------------------------------------
def entree(c, ref, kg):
    return c.appel(LOGIN, "POST", "/api/mouvements", {
        "code_type_mvt": "AJUST_INV_POS", "code_magasin": MAG, "code_motif": "INVENTAIRE",
        "lignes": [{"code_reference": ref, "quantite_saisie": kg, "unite_saisie": "kg",
                    "code_motif_ligne": "R1"}]})


def sortie(c, ref, kg):
    return c.appel(LOGIN, "POST", "/api/mouvements", {
        "code_type_mvt": "SORTIE_PROD", "code_magasin": MAG, "code_motif": "PRODUCTION",
        "numero_of": "OF-CHARGE",
        "lignes": [{"code_reference": ref, "quantite_saisie": kg, "unite_saisie": "kg",
                    "code_motif_ligne": None}]})


# ---------------------------------------------------------------------------
# Mesure
# ---------------------------------------------------------------------------
class Mesures:
    """Les appels d'une course : (duree en ms, statut). Sures entre fils."""

    def __init__(self):
        self.verrou = threading.Lock()
        self.appels = []
        # Un exemple de reponse par statut d'erreur : un 422 sous charge doit pouvoir
        # se lire (quelle regle ?) au lieu d'etre un simple compte.
        self.exemples = {}

    def noter(self, ms, statut):
        with self.verrou:
            self.appels.append((ms, statut))

    def chrono(self, fonction, *args):
        debut = time.perf_counter()
        try:
            statut, corps = fonction(*args)
        except Exception as e:  # noqa: BLE001 — une coupure reseau est une mesure aussi
            statut, corps = 0, {"exception": str(e)[:80]}
        self.noter((time.perf_counter() - debut) * 1000, statut)
        if not 200 <= statut < 300:
            with self.verrou:
                self.exemples.setdefault(str(statut), str(corps)[:220])
        return statut, corps

    def resume(self, duree):
        ms = sorted(m for m, _ in self.appels)
        statuts = {}
        for _, s in self.appels:
            statuts[s] = statuts.get(s, 0) + 1
        ok = sum(n for s, n in statuts.items() if 200 <= s < 300)

        def centile(p):
            if not ms:
                return None
            return round(ms[min(len(ms) - 1, math.ceil(p / 100 * len(ms)) - 1)], 1)

        return {
            "appels": len(ms), "reussis": ok, "debit_par_s": round(ok / duree, 1) if duree else None,
            "p50_ms": centile(50), "p95_ms": centile(95), "p99_ms": centile(99),
            "max_ms": round(ms[-1], 1) if ms else None,
            "statuts": {str(k): v for k, v in sorted(statuts.items())},
            "exemples": dict(self.exemples),
        }


def courir(n, duree, travail):
    """`n` fils qui repetent `travail(i, mesures)` pendant `duree` secondes."""
    mesures = Mesures()
    fin = time.perf_counter() + duree
    depart = threading.Barrier(n)

    def fil(i):
        depart.wait()
        while time.perf_counter() < fin:
            travail(i, mesures)

    fils = [threading.Thread(target=fil, args=(i,)) for i in range(n)]
    t0 = time.perf_counter()
    for f in fils:
        f.start()
    for f in fils:
        f.join()
    return mesures.resume(time.perf_counter() - t0)


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------
def scenario_lecture(c, refs):
    def travail(i, m):
        if i % 2:
            m.chrono(c.appel, LOGIN, "GET", "/api/bons-commande")
        else:
            ref = refs[i % len(refs)]
            m.chrono(c.appel, LOGIN, "GET",
                     f"/api/stock/lots?code_reference={ref.replace(' ', '%20')}&code_magasin={MAG}&limite=200")
    return travail


def scenario_refs_differentes(c, refs):
    # Entree puis sortie du meme kilo : le stock de chaque reference ne bouge pas.
    def travail(i, m):
        ref = refs[i % len(refs)]
        m.chrono(entree, c, ref, 1)
        m.chrono(sortie, c, ref, 1)
    return travail


def scenario_meme_ref(c, _refs):
    def travail(_i, m):
        m.chrono(entree, c, REF_COMMUNE, 1)
        m.chrono(sortie, c, REF_COMMUNE, 1)
    return travail


def scenario_lent_et_ecritures(c, refs):
    def travail(i, m):
        if i % 2:
            m.chrono(c.appel, LOGIN, "GET", "/api/cockpit")
        else:
            ref = refs[i % len(refs)]
            m.chrono(entree, c, ref, 1)
            m.chrono(sortie, c, ref, 1)
    return travail


def survente(c, infra, n):
    """N sorties ENSEMBLE ; le stock n'en couvre exactement que n // 2."""
    stock = float(infra.valeur(f"SELECT quantite_kg FROM stock_magasin WHERE code_reference = "
                               f"'{REF_SURVENTE}' AND code_magasin = '{MAG}'") or 0)
    passent = n // 2
    if stock <= 0 or passent == 0:
        return {"saute": f"stock {stock} kg"}
    part = math.floor(stock / passent * 10000) / 10000      # 4 decimales, comme la base
    mesures = Mesures()
    depart = threading.Barrier(n)
    resultats = []

    def fil():
        depart.wait()
        s, r = mesures.chrono(sortie, c, REF_SURVENTE, part)
        resultats.append((s, str(r)[:120]))

    fils = [threading.Thread(target=fil) for _ in range(n)]
    for f in fils:
        f.start()
    for f in fils:
        f.join()
    reussies = sum(1 for s, _ in resultats if s == 200)
    refusees_r02 = sum(1 for s, r in resultats if s == 422 and "R02" in r)
    reste = float(infra.valeur(f"SELECT quantite_kg FROM stock_magasin WHERE code_reference = "
                               f"'{REF_SURVENTE}' AND code_magasin = '{MAG}'"))
    return {
        "sessions": n, "stock_avant_kg": stock, "part_kg": part, "attendues": passent,
        "reussies": reussies, "refusees_R02": refusees_r02,
        "autres": n - reussies - refusees_r02, "stock_apres_kg": reste,
        "verdict": "JUSTE" if reussies <= passent and reste >= 0 else "SURVENTE",
        "detail": mesures.resume(1),
    }


# ---------------------------------------------------------------------------
def main():
    args = sys.argv[1:]

    def option(nom, defaut):
        return args[args.index(nom) + 1] if nom in args else defaut

    paliers = [int(x) for x in option("--paliers", "1,5,10,25,50").split(",")]
    duree = float(option("--duree", "15"))
    sortie_json = option("--sortie", None)
    garder = "--garder" in args
    infra_args = [a for a in args if a not in ("--garder",)]
    for nom in ("--paliers", "--duree", "--sortie"):
        if nom in infra_args:
            k = infra_args.index(nom)
            del infra_args[k:k + 2]

    infra = banc.Infra(infra_args + ["--port", str(PORT)])
    print(f"charge : base {infra.base}, serveur sur 127.0.0.1:{PORT}, paliers {paliers}, {duree:.0f} s")
    rapport = {"paliers": paliers, "duree_s": duree, "machine": os.environ.get("COMPUTERNAME", "?"),
               "scenarios": {}}
    try:
        infra.batir()
        infra.demarrer()
        c = banc.Client(f"http://127.0.0.1:{PORT}")
        c.ok(LOGIN, "GET", "/api/auth/moi")          # une seule connexion, partagee par les fils

        # Des references que l'on peut entrer et sortir sans lot : on les essaie. Prises
        # dans le REFERENTIEL, pas dans le stock — une base neuve n'en a aucun, ce sont
        # les scenarios du banc qui en creent.
        liste = infra.valeur(
            "SELECT string_agg(code_reference, '|') FROM (SELECT code_reference FROM reference "
            "WHERE actif = 1 AND COALESCE(suivi_lot::int, 0) = 0 ORDER BY code_reference LIMIT 200) s") or ""
        candidates = [r for r in liste.split("|") if r]
        refs, premier_refus = [], None
        for ref in candidates:
            e = entree(c, ref, 5000)
            s = sortie(c, ref, 1) if e[0] == 200 else e
            if e[0] == 200 and s[0] == 200:
                refs.append(ref)
            elif premier_refus is None:
                premier_refus = f"{ref} : {s[0]} {str(s[1])[:160]}"
            if len(refs) >= max(paliers):
                break
        code_commune = entree(c, REF_COMMUNE, 50000)[0]
        print(f"  {len(candidates)} references au referentiel, {len(refs)} utilisables (entree et sortie sans lot) ;"
              f" stock de {REF_COMMUNE} : {code_commune}")
        if premier_refus:
            print(f"  premier refus : {premier_refus}")
        if not refs or code_commune != 200:
            raise banc.Echec("pas de reference utilisable pour le banc de charge")
        deadlocks_avant = int(infra.valeur(
            f"SELECT deadlocks FROM pg_stat_database WHERE datname = '{infra.base}'"))

        scenarios = [("lecture", scenario_lecture), ("refs_differentes", scenario_refs_differentes),
                     ("meme_ref", scenario_meme_ref), ("lent_et_ecritures", scenario_lent_et_ecritures)]
        for nom, fabrique in scenarios:
            rapport["scenarios"][nom] = {}
            for n in paliers:
                r = courir(n, duree, fabrique(c, refs))
                rapport["scenarios"][nom][str(n)] = r
                autres = {k: v for k, v in r["statuts"].items() if not k.startswith("2")}
                print(f"  {nom:18} {n:3} sessions : {r['debit_par_s']!s:>7} /s  p50 {r['p50_ms']!s:>7} ms  "
                      f"p95 {r['p95_ms']!s:>7} ms  p99 {r['p99_ms']!s:>7} ms  hors 2xx {autres or '-'}",
                      flush=True)
                for statut, exemple in r["exemples"].items():
                    if statut != "503":
                        print(f"      {statut} : {exemple}", flush=True)

        n_survente = max(paliers)
        entree(c, REF_SURVENTE, 100)
        rapport["survente"] = survente(c, infra, n_survente)
        s = rapport["survente"]
        print(f"  survente           {n_survente:3} sorties ensemble : {s.get('reussies')} passees "
              f"pour {s.get('attendues')} attendues, stock apres {s.get('stock_apres_kg')} kg -> {s.get('verdict')}")

        rapport["deadlocks"] = int(infra.valeur(
            f"SELECT deadlocks FROM pg_stat_database WHERE datname = '{infra.base}'")) - deadlocks_avant
        rapport["c11_ecarts"] = int(infra.valeur("SELECT anomalies FROM v_controles WHERE code = 'C11'"))
        journal = (Path(infra.vide) / "serveur.log").read_text(encoding="utf-8", errors="replace")
        # Avant le 17/10, l'epuisement s'ecrivait en erreur interne (PoolTimedOut) ;
        # depuis, il sort en 503 et s'annonce par un avertissement.
        rapport["pool_epuise"] = (journal.count("PoolTimedOut") + journal.count("pool timed out")
                                  + journal.count("pool de connexions epuise"))
        print(f"  interblocages : {rapport['deadlocks']}   ecarts C11 (cache / grand livre) : "
              f"{rapport['c11_ecarts']}   pool epuise : {rapport['pool_epuise']}")
    finally:
        infra.arreter(garder)
    if sortie_json:
        Path(sortie_json).write_text(json.dumps(rapport, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"  resultats : {sortie_json}")


if __name__ == "__main__":
    sys.exit(main())
