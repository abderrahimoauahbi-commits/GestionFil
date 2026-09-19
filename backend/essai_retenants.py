# -*- coding: utf-8 -*-
"""Ce qui retient une ligne, vu de l'API — et le refus qui en decoule."""
import json, subprocess, sys, urllib.error, urllib.parse, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
B = "http://127.0.0.1:8084"
PSQL = r"C:\Program Files\PostgreSQL\18\bin\psql.exe"
ENVP = {"PGPASSWORD": "toor", "SYSTEMROOT": r"C:\Windows"}
def sql(q):
    r = subprocess.run([PSQL, "-h", "localhost", "-U", "postgres", "-d", "gestionfil_essai3",
                        "-At", "-f", "-"], input=q, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=ENVP)
    return ((r.stdout or "") + (r.stderr or "")).strip()
def api(m, c, b=None, j=None):
    r = urllib.request.Request(B + c, data=json.dumps(b).encode() if b is not None else None, method=m)
    r.add_header("Content-Type", "application/json")
    if j: r.add_header("Authorization", "Bearer " + j)
    try:
        with urllib.request.urlopen(r, timeout=60) as p:
            return p.status, json.loads(p.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:400]
J = api("POST", "/api/auth/connexion", {"login": "admin", "mot_de_passe": "Rahim@03081975"})[1]["jeton"]

print("1. UNE REFERENCE TRES UTILISEE — qu'est-ce qui la retient ?")
u = "/api/catalogue/" + urllib.parse.quote("Bande", safe="") + "/retenants"
s, c = api("GET", u, None, J)
print("   ", s, json.dumps(c, ensure_ascii=False)[:280])

print("\n2. ON TENTE DE LA SUPPRIMER : le refus nomme-t-il TOUT ?")
s, c = api("DELETE", "/api/catalogue/" + urllib.parse.quote("Bande", safe=""), None, J)
print("   ", s)
print("   ", (c if isinstance(c, str) else json.dumps(c, ensure_ascii=False))[:400])

print("\n3. UNE COULEUR INUTILISEE — supprimable ?")
libre = sql("SELECT code_couleur_interne FROM couleur c WHERE NOT EXISTS "
            "(SELECT 1 FROM reference r WHERE r.code_couleur_interne = c.code_couleur_interne) LIMIT 1")
print("    couleur sans reference :", libre or "(aucune)")
if libre:
    s, c = api("GET", "/api/couleurs/" + urllib.parse.quote(libre, safe="") + "/retenants", None, J)
    print("   ", s, json.dumps(c, ensure_ascii=False)[:200])
