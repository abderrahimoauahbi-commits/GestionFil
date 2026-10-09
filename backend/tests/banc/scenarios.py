# -*- coding: utf-8 -*-
"""
Les scenarios du banc (voir banc.py). Chacun part d'un etat qu'il cree
lui-meme — un bon, une reception, du stock — et verifie, par l'API comme un
utilisateur et par SQL comme un controleur, que les regles tiennent.

Comptes (seed_110) : Assistante (ASSISTANTE), Choukri et Mohamed (DIRECTION),
Magasinie (MAGASIN), admin (ADMIN). Fournisseur FRS-011 (MAD), references
PLA 100 CHE et PLA 50 CHE (sans suivi de lot), magasins Morocco et Polyfashions.
"""
from banc import Echec, verifier

FRS = "FRS-011"
REF = "PLA 100 CHE"
REF2 = "PLA 50 CHE"
MAG = "Morocco"


# ---------------------------------------------------------------------------
# Outils
# ---------------------------------------------------------------------------
def kg(infra, ref=REF, mag=MAG):
    v = infra.valeur(f"SELECT quantite_kg FROM stock_magasin WHERE code_reference = '{ref}' AND code_magasin = '{mag}'")
    return float(v) if v is not None else 0.0


def cmup_magasin(infra, ref=REF, mag=MAG):
    v = infra.valeur(f"SELECT cmup_mad FROM stock_magasin WHERE code_reference = '{ref}' AND code_magasin = '{mag}'")
    return float(v) if v is not None else None


def controle(infra, code):
    return int(infra.valeur(f"SELECT anomalies FROM v_controles WHERE code = '{code}'"))


def refus_sql(infra, requete, contient):
    """La base doit refuser la requete, et pour la raison attendue (un refus quelconque ne prouve rien)."""
    try:
        infra.sql(requete)
    except RuntimeError as e:
        verifier(contient.lower() in str(e).lower(), f"refus sans « {contient} » : {str(e)[:300]}")
        return
    raise Echec(f"la base a accepte : {requete[:120]}")


def bon_envoye(c, lignes, frs=FRS):
    """Un bon saisi par l'assistante, valide par la Direction, envoye. Rend (id_bc, lignes du bon)."""
    bc = c.ok("Assistante", "POST", "/api/bons-commande", {
        "code_fournisseur": frs,
        "lignes": [{"code_reference": r, "unite_commande": "kg", "quantite_commandee_unite": q,
                    "prix_unitaire_devise": p} for r, q, p in lignes],
    })
    id_bc = bc["id_bc"]
    c.ok("Assistante", "PUT", f"/api/bons-commande/{id_bc}/statut", {"statut": "EN_ATTENTE_VALIDATION"})
    c.ok("Choukri", "PUT", f"/api/bons-commande/{id_bc}/statut", {"statut": "VALIDE"})
    c.ok("Choukri", "PUT", f"/api/bons-commande/{id_bc}/statut", {"statut": "ENVOYE"})
    lignes = c.ok("Choukri", "GET", f"/api/bons-commande/{id_bc}/lignes")
    if isinstance(lignes, dict):
        lignes = lignes.get("lignes", [])
    return id_bc, lignes


def reception_validee(c, id_bc, lignes_bc, pesees, mag=MAG, **ligne_extra):
    """Pesee par le magasinier, soumise, validee par la Direction. Rend l'id de la reception."""
    lignes = []
    for lb, q in zip(lignes_bc, pesees):
        lignes.append(dict({"code_reference": lb["code_reference"], "id_ligne_bc": lb["id_ligne_bc"],
                            "unite_saisie": "kg", "quantite_pesee_unite": q, "code_magasin_dest": mag},
                           **ligne_extra))
    r = c.ok("Magasinie", "POST", "/api/receptions", {"id_bc": id_bc, "num_bon_livraison": "BL-BANC", "lignes": lignes})
    rid = r["id_reception"]
    c.ok("Magasinie", "PUT", f"/api/receptions/{rid}/statut", {"statut": "A_CONTROLER"})
    c.ok("Choukri", "POST", f"/api/receptions/{rid}/valider")
    return rid


def entree_stock(c, ref, quantite, prix=20.0, mag=MAG):
    id_bc, lignes = bon_envoye(c, [(ref, quantite, prix)])
    return reception_validee(c, id_bc, lignes, [quantite], mag=mag)


def mouvement(c, login, type_mvt, lignes, mag=MAG, motif="PRODUCTION", motif_ligne=None, **extra):
    corps = {"code_type_mvt": type_mvt, "code_magasin": mag, "code_motif": motif,
             "lignes": [{"code_reference": r, "quantite_saisie": q, "unite_saisie": "kg",
                         "code_motif_ligne": motif_ligne} for r, q in lignes]}
    corps.update(extra)
    return c.appel(login, "POST", "/api/mouvements", corps)


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------
def scenario_bon_segregation(c, infra):
    """Creer un bon et le valider sont deux mains (B4) ; un bon valide puis devalide ne s'efface pas."""
    bc = c.ok("Assistante", "POST", "/api/bons-commande", {
        "code_fournisseur": FRS,
        "lignes": [{"code_reference": REF, "unite_commande": "kg", "quantite_commandee_unite": 500,
                    "prix_unitaire_devise": 20}]})
    id_bc = bc["id_bc"]
    c.ok("Assistante", "PUT", f"/api/bons-commande/{id_bc}/statut", {"statut": "EN_ATTENTE_VALIDATION"})
    c.refus("Assistante", "PUT", f"/api/bons-commande/{id_bc}/statut", {"statut": "VALIDE"})
    c.refus("Magasinie", "PUT", f"/api/bons-commande/{id_bc}/statut", {"statut": "VALIDE"})
    c.ok("Choukri", "PUT", f"/api/bons-commande/{id_bc}/statut", {"statut": "VALIDE"})
    c.ok("Choukri", "POST", f"/api/devalider/bons-commande/{id_bc}", {"motif": "Essai du banc : retour en brouillon"})
    c.refus("Assistante", "DELETE", f"/api/bons-commande/{id_bc}", contient="annulez")


def scenario_reception_cloture_avoir(c, infra):
    """Reception 3-en-1, cloture par facture sur les lots de la reception, avoir, pas de devalidation."""
    avant = kg(infra)
    id_bc, lignes = bon_envoye(c, [(REF, 1000, 20)])
    # Le saisisseur ne valide pas sa propre pesee (B4-2).
    r = c.ok("Magasinie", "POST", "/api/receptions", {"id_bc": id_bc, "num_bon_livraison": "BL-1", "lignes": [{
        "code_reference": REF, "id_ligne_bc": lignes[0]["id_ligne_bc"], "unite_saisie": "kg",
        "quantite_pesee_unite": 1010, "code_magasin_dest": MAG}]})
    rid = r["id_reception"]
    c.ok("Magasinie", "PUT", f"/api/receptions/{rid}/statut", {"statut": "A_CONTROLER"})
    c.refus("Magasinie", "POST", f"/api/receptions/{rid}/valider")
    c.ok("Choukri", "POST", f"/api/receptions/{rid}/valider")
    verifier(abs(kg(infra) - avant - 1010) < 1e-6, f"stock attendu +1010 kg, obtenu {kg(infra) - avant}")
    verifier(controle(infra, "C11") == 0, "C11 : le cache s'ecarte du grand livre apres la reception")

    # Le magasinier ne voit pas les montants de la reception (regle 16).
    texte = str(c.ok("Magasinie", "GET", "/api/receptions")) + str(c.ok("Magasinie", "GET", f"/api/receptions/{rid}/lignes"))
    for champ in ("total_mad", "prix_kg_mad", "montant_facture_mad"):
        verifier(f"'{champ}'" not in texte, f"le magasinier lit {champ} sur les receptions")

    # Cloture : +10 % sur 1 010 kg tous encore la -> tout au stock de Morocco.
    ap = c.ok("Choukri", "POST", f"/api/receptions/{rid}/cloturer",
              {"numero_facture": "F-BANC-1", "montant_facture": 22220, "frais_mad": 0, "simuler": True})
    verifier(abs(ap["difference_mad"] - 2020) < 0.01, f"difference attendue 2 020, obtenue {ap['difference_mad']}")
    verifier(abs(ap["ecart_prix_mad"]) < 0.01, "rien n'est sorti : pas d'ecart de prix attendu")
    cm_avant = cmup_magasin(infra)
    c.ok("Choukri", "POST", f"/api/receptions/{rid}/cloturer",
         {"numero_facture": "F-BANC-1", "montant_facture": 22220, "frais_mad": 0})
    cm_apres = cmup_magasin(infra)
    verifier(abs(cm_apres - (cm_avant + 2020 / kg(infra))) < 0.0002,
             f"CMUP Morocco : {cm_avant} + 2020/{kg(infra)} attendu, obtenu {cm_apres}")
    # Un avoir sans motif est refuse ; motive, il baisse le CMUP du meme calcul.
    c.refus("Choukri", "POST", f"/api/receptions/{rid}/avoir",
            {"nature": "AVOIR", "numero_piece": "AV-1", "montant_mad": 1010, "motif": ""})
    c.refus("Magasinie", "POST", f"/api/receptions/{rid}/avoir",
            {"nature": "AVOIR", "numero_piece": "AV-1", "montant_mad": 1010, "motif": "Remise du mois"}, codes=(403,))
    c.ok("Choukri", "POST", f"/api/receptions/{rid}/avoir",
         {"nature": "AVOIR", "numero_piece": "AV-1", "montant_mad": 1010, "motif": "Remise du mois"})
    verifier(abs(cmup_magasin(infra) - (cm_apres - 1010 / kg(infra))) < 0.0002, "l'avoir n'a pas baisse le CMUP")
    n = int(infra.valeur(f"SELECT count(*) FROM reception_ajustements_cmup WHERE id_reception = '{rid}' AND origine = 'AVOIR'"))
    verifier(n >= 1, "l'avoir n'est pas journalise")
    # Cloturee, elle ne recule plus.
    c.refus("Choukri", "POST", f"/api/devalider/receptions/{rid}", {"motif": "Essai : devalider une cloture"})
    c.refus("Choukri", "PUT", f"/api/receptions/{rid}/statut", {"statut": "A_CONTROLER"})
    # F18 (09/10) : cloturee, elle reste au cout de revient ; un avoir sur des kilos sortis
    # va au rapport des ecarts de prix.
    verifier(int(infra.valeur(f"SELECT count(*) FROM v_cout_revient WHERE numero_reception = "
                              f"(SELECT numero_reception FROM reception WHERE id_reception = '{rid}')")) >= 1,
             "la reception cloturee a quitte le cout de revient")
    # Presque tout sort (le magasin ne garde que 100 kg de la reference) : l'avoir revient
    # alors surtout a des kilos sortis.
    sortie = round(float(infra.valeur(f"SELECT quantite_kg FROM stock_magasin WHERE code_reference = '{REF}' "
                                      f"AND code_magasin = '{MAG}'")) - 100, 4)
    code, r = mouvement(c, "Choukri", "SORTIE_PROD", [(REF, sortie)], numero_of="OF-BANC-F18")
    verifier(code == 200, f"sortie de {sortie} kg refusee : {r}")
    c.ok("Choukri", "POST", f"/api/receptions/{rid}/avoir",
         {"nature": "AVOIR", "numero_piece": "AV-2", "montant_mad": 1000, "motif": "Remise apres consommation"})
    numero = infra.valeur(f"SELECT numero_reception FROM reception WHERE id_reception = '{rid}'")
    ecarts = c.ok("Choukri", "GET", "/api/ecarts-prix")
    miennes = [l for l in ecarts["lignes"] if l["document"] == numero]
    verifier(miennes and all(l["montant_mad"] < 0 for l in miennes),
             f"l'avoir sur kilos sortis n'apparait pas en gain au rapport : {miennes}")


def scenario_ecart_pesee(c, infra):
    """L'excedent au-dela de la tolerance du fournisseur demande une derogation motivee ; le manque, non."""
    id_bc, lignes = bon_envoye(c, [(REF, 1000, 20)])
    lb = lignes[0]
    base = {"code_reference": REF, "id_ligne_bc": lb["id_ligne_bc"], "unite_saisie": "kg", "code_magasin_dest": MAG}
    # +5 % sans derogation : refus (a la creation ou a la soumission).
    code, r = c.appel("Magasinie", "POST", "/api/receptions",
                      {"id_bc": id_bc, "lignes": [dict(base, quantite_pesee_unite=1050)]})
    if code == 200:
        c.refus("Magasinie", "PUT", f"/api/receptions/{r['id_reception']}/statut", {"statut": "A_CONTROLER"})
        c.ok("Magasinie", "PUT", f"/api/receptions/{r['id_reception']}/statut", {"statut": "ANNULE"})
    else:
        verifier(code == 422, f"excedent sans derogation : 422 attendu, obtenu {code} {r}")
    # Un manque de 30 % : une livraison partielle, sans derogation.
    rid = reception_validee(c, id_bc, lignes, [700])
    verifier(controle(infra, "C10") == 0, "C10 leve sur une livraison partielle")
    # Le reste (300 kg) : +5 % avec derogation motivee passe.
    r = c.ok("Magasinie", "POST", "/api/receptions", {"id_bc": id_bc, "lignes": [dict(
        base, quantite_pesee_unite=315, derogation_ecart=True, motif_derogation="Accord du fournisseur, avenant 3")]})
    c.ok("Magasinie", "PUT", f"/api/receptions/{r['id_reception']}/statut", {"statut": "A_CONTROLER"})
    c.ok("Choukri", "POST", f"/api/receptions/{r['id_reception']}/valider")


def scenario_saisie_libre(c, infra):
    """Saisie libre : ajustements et gros dechets a VALIDER, retour fournisseur rattache a sa reception."""
    rid = entree_stock(c, REF2, 400)
    numero = infra.valeur(f"SELECT numero_reception FROM reception WHERE id_reception = '{rid}'")
    # Le magasinier : petit dechet oui, gros non, ajustement non.
    code, r = mouvement(c, "Magasinie", "SORTIE_PROD", [(REF2, 20)], numero_of="OF-BANC")
    verifier(code == 200, f"dechet de 20 kg refuse au magasinier : {r}")
    code, r = mouvement(c, "Magasinie", "SORTIE_PROD", [(REF2, 60)], numero_of="OF-BANC")
    verifier(code == 422, f"dechet de 60 kg accepte au magasinier : {code} {r}")
    code, r = mouvement(c, "Magasinie", "AJUST_INV_NEG", [(REF2, 5)], motif="INVENTAIRE")
    verifier(code == 403, f"ajustement accepte au magasinier : {code} {r}")
    # Le retour fournisseur : VALIDER des receptions, rattache, plafonne.
    code, r = mouvement(c, "Magasinie", "RETOUR_FOURN", [(REF2, 10)], motif="RETOUR_FOUR", reference_document=numero)
    verifier(code == 403, f"retour fournisseur accepte au magasinier : {code}")
    code, r = mouvement(c, "Choukri", "RETOUR_FOURN", [(REF2, 10)], motif="RETOUR_FOUR")
    verifier(code == 422, f"retour sans reception accepte : {code} {r}")
    code, r = mouvement(c, "Choukri", "RETOUR_FOURN", [(REF2, 500)], motif="RETOUR_FOUR", reference_document=numero)
    verifier(code == 422, f"retour au-dela du recu accepte : {code} {r}")
    code, r = mouvement(c, "Choukri", "RETOUR_FOURN", [(REF2, 30)], motif="RETOUR_FOUR", motif_ligne="R1",
                        reference_document=numero)
    verifier(code == 200, f"retour de 30 kg refuse : {r}")
    # Le prix d'une sortie ou d'une entree libre est le CMUP, jamais une saisie.
    verifier(controle(infra, "C11") == 0, "C11 apres la saisie libre")


def scenario_stock_jamais_negatif(c, infra):
    """R02 : une sortie au-dela du stock est refusee par la base, et le message remonte tel quel."""
    stock = kg(infra, REF2)
    code, r = mouvement(c, "Choukri", "SORTIE_PROD", [(REF2, stock + 1)], numero_of="OF-BANC")
    verifier(code == 422 and "R02" in str(r), f"sortie au-dela du stock : {code} {r}")


def scenario_contre_passation(c, infra):
    """Defaire sans effacer : l'inverse est poste, le stock revient, l'original reste."""
    entree_stock(c, REF2, 200)
    avant = kg(infra, REF2)
    code, r = mouvement(c, "Magasinie", "SORTIE_PROD", [(REF2, 15)], numero_of="OF-BANC")
    verifier(code == 200, f"dechet refuse : {r}")
    id_mvt = r["id_mouvement"]
    c.refus("Magasinie", "POST", f"/api/mouvements/{id_mvt}/contre-passer", {"motif": "Erreur de saisie"}, codes=(403,))
    c.refus("Choukri", "POST", f"/api/mouvements/{id_mvt}/contre-passer", {"motif": ""})
    c.ok("Choukri", "POST", f"/api/mouvements/{id_mvt}/contre-passer", {"motif": "Erreur de saisie du banc"})
    verifier(abs(kg(infra, REF2) - avant) < 1e-6, "le stock n'est pas revenu apres la contre-passation")
    n = int(infra.valeur(f"SELECT count(*) FROM mouvement WHERE id_mouvement = '{id_mvt}'"))
    verifier(n == 1, "le mouvement d'origine a disparu")
    c.refus("Choukri", "POST", f"/api/mouvements/{id_mvt}/contre-passer", {"motif": "Deuxieme fois"})


def scenario_inventaire(c, infra):
    """Un seul inventaire en cours par magasin ; le magasinier compte, la Direction cloture."""
    entree_stock(c, REF, 300, mag="Polyfashions")
    inv = c.ok("Choukri", "POST", "/api/inventaires", {"code_magasin": "Polyfashions", "type_inventaire": "GLOBAL"})
    iid = inv["id_inventaire"]
    c.ok("Choukri", "POST", f"/api/inventaires/{iid}/ouvrir")
    inv2 = c.ok("Choukri", "POST", "/api/inventaires", {"code_magasin": "Polyfashions", "type_inventaire": "GLOBAL"})
    c.refus("Choukri", "POST", f"/api/inventaires/{inv2['id_inventaire']}/ouvrir")
    lignes = c.ok("Magasinie", "GET", f"/api/inventaires/{iid}/lignes")
    ligne = next(l for l in lignes if l["code_reference"] == REF)
    theorique = float(ligne["quantite_theorique_kg"])
    # Un inventaire global se clot quand TOUTES ses lignes sont comptees : les
    # autres au theorique, la notre avec 12 kg de moins.
    comptages = [{"code_reference": l["code_reference"], "code_magasin": "Polyfashions",
                  "lot_fournisseur": l.get("lot_fournisseur"),
                  "quantite_comptee_kg": float(l["quantite_theorique_kg"] or 0)} for l in lignes if l is not ligne]
    comptages.append({"code_reference": REF, "code_magasin": "Polyfashions",
                      "lot_fournisseur": ligne.get("lot_fournisseur"),
                      "quantite_comptee_kg": theorique - 12, "motif_ecart": "Bobine abimee au quai"})
    c.ok("Magasinie", "PUT", f"/api/inventaires/{iid}/lignes", {"comptages": comptages})
    c.refus("Magasinie", "POST", f"/api/inventaires/{iid}/cloturer", codes=(403,))
    c.ok("Choukri", "POST", f"/api/inventaires/{iid}/cloturer")
    verifier(abs(kg(infra, REF, "Polyfashions") - (theorique - 12)) < 1e-6, "la cloture n'a pas ajuste le stock")
    c.refus("Choukri", "POST", f"/api/inventaires/{iid}/cloturer")
    c.ok("Choukri", "POST", f"/api/inventaires/{inv2['id_inventaire']}/annuler", {"motif": "Doublon du banc"})
    verifier(controle(infra, "C44") == 0, "C44 : deux inventaires en cours")


def scenario_colisage_signale(c, infra):
    """Un colisage absurde se signale (C43), il ne bloque pas (decision du 08/10)."""
    ref = infra.valeur("SELECT code_reference FROM reference WHERE poids_bobine_kg > 0 AND bobines_par_palette > 0 "
                       "AND code_fournisseur IS NOT NULL ORDER BY code_reference LIMIT 1")
    verifier(ref is not None, "aucune reference avec conditionnement dans le referentiel du banc")
    frs = infra.valeur(f"SELECT code_fournisseur FROM reference WHERE code_reference = '{ref}'")
    avant = controle(infra, "C43")
    code, r = c.appel("Assistante", "POST", "/api/bons-commande", {"code_fournisseur": frs, "lignes": [{
        "code_reference": ref, "unite_commande": "kg", "quantite_commandee_unite": 4032,
        "prix_unitaire_devise": 10, "nb_bobines": 1920, "nb_palettes": 20}]})
    verifier(code == 200, f"un colisage incoherent bloque le bon : {code} {r}")
    verifier(controle(infra, "C43") > avant, "C43 ne signale pas le colisage incoherent")


def scenario_declencheurs(c, infra):
    """Les invariants en base : grand livre, audit et journal de cloture immuables."""
    for requete, quoi in (
        ("UPDATE ligne_mouvement SET quantite_kg = quantite_kg + 1 WHERE id_mouvement = "
         "(SELECT id_mouvement FROM ligne_mouvement LIMIT 1)", "le grand livre"),
        ("DELETE FROM audit_log WHERE id_audit = (SELECT id_audit FROM audit_log LIMIT 1)", "le journal d'audit"),
        ("UPDATE reception_ajustements_cmup SET montant_mad = 0 WHERE id_ajustement = "
         "(SELECT id_ajustement FROM reception_ajustements_cmup LIMIT 1)", "le journal de cloture"),
    ):
        table = requete.split()[1] if requete.startswith("UPDATE") else requete.split()[2]
        verifier(int(infra.valeur(f"SELECT count(*) FROM {table}")) > 0,
                 f"{quoi} est vide : rien a tenter (scenario joue trop tot)")
        try:
            infra.sql(requete)
        except RuntimeError:
            continue
        raise Echec(f"{quoi} s'est laisse modifier")


def scenario_masquage(c, infra):
    """Le magasinier ne lit aucun prix ; l'assistante lit le montant de ses bons (regression du 08/10)."""
    lots = c.ok("Magasinie", "GET", "/api/stock/lots")
    verifier("prix_entree_mad" not in str(lots), "le magasinier lit le prix d'entree des lots")
    stock = c.ok("Magasinie", "GET", "/api/stock")
    verifier("cmup_mad" not in str(stock), "le magasinier lit le CMUP")
    # Un bon a soi, pour ne pas dependre des scenarios precedents.
    c.ok("Assistante", "POST", "/api/bons-commande", {"code_fournisseur": FRS, "lignes": [{
        "code_reference": REF, "unite_commande": "kg", "quantite_commandee_unite": 50, "prix_unitaire_devise": 20}]})
    bons = c.ok("Assistante", "GET", "/api/bons-commande")
    verifier(any(b.get("montant_total_mad") for b in bons), "l'assistante ne lit plus le montant de ses bons")


def scenario_controles_finaux(c, infra):
    """Apres tout le banc : cache = grand livre, stock lot = stock magasin, tableau de bord en 200."""
    for code in ("C11", "C15"):
        verifier(controle(infra, code) == 0, f"{code} non nul a la fin du banc")
    c.ok("Choukri", "GET", "/api/cockpit")
    # LA LISTE EXACTE (audit v5, U16) : « au moins 40 » laissait passer un controle perdu.
    manquants = infra.valeur("SELECT string_agg(c, ', ') FROM (SELECT 'C' || lpad(g::text, 2, '0') AS c "
                             "FROM generate_series(1, 52) g EXCEPT SELECT code FROM v_controles) x")
    verifier(not manquants, f"controles absents de v_controles : {manquants}")
    verifier(int(infra.valeur("SELECT count(*) FROM v_controles")) == 52, "v_controles porte des doublons")


def scenario_import(c, infra):
    """Dossier d'import : facture au cours BAM, reception avec derogation, pesee figee au controle,
    validation, cloture qui porte les frais aux lots du dossier."""
    ref = "PP-1500 Dtex-Cream 2951-Hs"
    aujourdhui = infra.valeur("SELECT to_char(current_date, 'YYYY-MM-DD')")
    d = c.ok("Choukri", "POST", "/api/import/dossiers", {"numero": "BANC/26", "code_devise": "USD"})
    id_dossier = d.get("id_dossier") or d.get("id")
    cours = c.ok("Choukri", "GET", f"/api/import/taux-reference?devise=USD&date={aujourdhui}")["reference"]
    verifier(cours and cours > 1, f"pas de cours BAM pour l'USD : {cours}")
    # Le taux 1 en devise est refuse (regle 18).
    c.refus("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/factures", {
        "code_fournisseur": "FRS-001", "numero_facture": "FB-0", "date_facture": aujourdhui,
        "code_devise": "USD", "taux_change": 1, "montant_devise": 2000})
    f = c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/factures", {
        "code_fournisseur": "FRS-001", "numero_facture": "FB-1", "date_facture": aujourdhui,
        "code_devise": "USD", "taux_change": cours, "montant_devise": 2000})
    id_facture = f.get("id_facture") or f.get("id")
    c.ok("Choukri", "POST", f"/api/import/factures/{id_facture}/lignes", {
        "type_ligne": "ERP", "code_reference": ref, "unite": "kg", "quantite": 1000, "poids_net_kg": 1000,
        "prix_unitaire_devise": 2.0, "lot_fournisseur": "LOT-BANC-1"})
    c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/frais", {
        "id_frais": "DOUANE", "numero_piece": "DUM-BANC", "montant_devise": 5000, "code_devise": "MAD"})

    ligne = next(x for x in c.ok("Magasinie", "GET", "/api/import/a-recevoir") if x["code_reference"] == ref
                 and x["numero_dossier"] == "BANC/26")
    verifier(ligne.get("tolerance_pesee_pct") is not None, "la tolerance du fournisseur ne descend pas a l'ecran")
    base = {"id_ligne": ligne["id_ligne"], "quantite_recue_kg": 1050, "code_magasin": MAG,
            "lot_fournisseur": "LOT-BANC-1", "nb_bobines": 404}
    r = c.ok("Magasinie", "POST", "/api/import/receptions", {"date_reception": aujourdhui, "lignes": [base]})
    rid = r["id_reception"]
    c.refus("Magasinie", "PUT", f"/api/import/receptions/{rid}/statut", {"statut": "A_CONTROLER"}, contient="tolérance")
    # Suivie au lot, la reference se compte en bobines (regle 13).
    c.ok("Magasinie", "PUT", f"/api/import/receptions/{rid}",
         {"lignes": [dict(base, nb_bobines=0, derogation_ecart=1, motif_derogation="Accord du fournisseur, avoir a venir")]})
    c.refus("Magasinie", "PUT", f"/api/import/receptions/{rid}/statut", {"statut": "A_CONTROLER"}, contient="bobines")
    c.refus("Magasinie", "PUT", f"/api/import/receptions/{rid}",
            {"lignes": [dict(base, derogation_ecart=1, motif_derogation="ok")]})
    motive = dict(base, derogation_ecart=1, motif_derogation="Accord du fournisseur, avoir a venir")
    c.ok("Magasinie", "PUT", f"/api/import/receptions/{rid}", {"lignes": [motive]})
    c.ok("Magasinie", "PUT", f"/api/import/receptions/{rid}/statut", {"statut": "A_CONTROLER"})
    # Au controle, la pesee est figee ; le verdict ne l'est pas.
    c.refus("Choukri", "PUT", f"/api/import/receptions/{rid}", {"lignes": [dict(motive, quantite_recue_kg=1040)]})
    c.refus("Magasinie", "POST", f"/api/import/receptions/{rid}/valider")
    avant = kg(infra, ref)
    # U4 (09/10) : le verdict part avec la validation, d'un bloc. Une pesee changee au passage
    # fait tout echouer ; rien n'est ecrit.
    c.refus("Choukri", "POST", f"/api/import/receptions/{rid}/valider",
            {"reception": {"lignes": [dict(motive, quantite_recue_kg=1040)], "notes": "essai"}}, contient="fig")
    verifier(infra.valeur(f"SELECT COALESCE(notes, '-') FROM import_receptions WHERE id_reception = '{rid}'") == "-",
             "une validation refusee a laisse sa saisie ecrite")
    c.ok("Choukri", "POST", f"/api/import/receptions/{rid}/valider",
         {"reception": {"lignes": [motive], "notes": "Controle visuel fait au quai"}})
    verifier(infra.valeur(f"SELECT notes FROM import_receptions WHERE id_reception = '{rid}'") == "Controle visuel fait au quai",
             "le verdict n'est pas parti avec la validation")
    verifier(abs(kg(infra, ref) - avant - 1050) < 1e-6, "l'import n'est pas entre en stock")
    cm = cmup_magasin(infra, ref)
    verifier(abs(cm - 2.0 * cours) < 0.01, f"CMUP d'entree attendu {2.0 * cours:.4f} (prix x cours), obtenu {cm}")

    # Regle 5 : une DUM saisie ne s'efface pas ; elle se corrige avec un motif, au droit de valider.
    c.ok("Choukri", "PATCH", f"/api/import/dossiers/{id_dossier}", {"numero_dum": "DUM-BANC-1"})
    c.refus("Choukri", "PATCH", f"/api/import/dossiers/{id_dossier}", {"numero_dum": ""}, contient="efface")
    c.refus("Choukri", "PATCH", f"/api/import/dossiers/{id_dossier}", {"numero_dum": "DUM-BANC-2"}, contient="pourquoi")
    c.ok("Choukri", "PATCH", f"/api/import/dossiers/{id_dossier}",
         {"numero_dum": "DUM-BANC-2", "motif_dum": "Faute de frappe sur la serie"})
    refus_sql(infra, f"UPDATE import_dossiers SET numero_dum = NULL WHERE id_dossier = '{id_dossier}'", "IMPORT-DUM")

    # Cloture : les 5 000 MAD de douane vont au lot du dossier, tout encore la.
    ap = c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/cloturer", {"simuler": True})
    verifier(abs(ap["ecart_stock_dhs"] - 5000) < 0.01 and abs(ap["ecart_consomme_dhs"]) < 0.01,
             f"frais attendus 5 000 au stock, obtenus {ap['ecart_stock_dhs']} / {ap['ecart_consomme_dhs']}")
    c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/cloturer", {"simuler": False})
    verifier(abs(cmup_magasin(infra, ref) - (cm + 5000 / kg(infra, ref))) < 0.0002, "les frais n'ont pas rejoint le CMUP")

    # Regle 5 : clos, le dossier est fige et ne se rouvre plus ; une facture tardive passe en
    # frais post-cloture, repartie sur le stock restant sans rouvrir le dossier.
    c.refus("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/frais", {
        "id_frais": "DOUANE", "numero_piece": "TARDIF", "montant_devise": 1000, "code_devise": "MAD"})
    c.refus("Choukri", "POST", f"/api/devalider/dossiers-import/{id_dossier}", {"motif": "Essai de reouverture"})
    tardif = {"id_frais": "DOUANE", "numero_piece": "TARDIF", "montant_devise": 1000, "code_devise": "MAD"}
    c.refus("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/frais-post-cloture", dict(tardif))
    cm = cmup_magasin(infra, ref)
    ap = c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/frais-post-cloture",
              dict(tardif, motif="Facture du transitaire arrivee apres la cloture", simuler=True))
    verifier(abs(ap["ecart_stock_dhs"] - 1000) < 0.01, f"post-cloture : {ap['ecart_stock_dhs']} au stock au lieu de 1 000")
    verifier(abs(cmup_magasin(infra, ref) - cm) < 1e-6, "l'apercu du frais post-cloture a ecrit")
    c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/frais-post-cloture",
         dict(tardif, motif="Facture du transitaire arrivee apres la cloture"))
    verifier(abs(cmup_magasin(infra, ref) - (cm + 1000 / kg(infra, ref))) < 0.0002, "le frais post-cloture n'a pas rejoint le CMUP")
    verifier(infra.valeur(f"SELECT statut FROM import_dossiers WHERE id_dossier = '{id_dossier}'") == "CLOTURE",
             "le frais post-cloture a rouvert le dossier")

    # Le cout de revient reel : un paiement au cours de la banque, son ecart de change,
    # sans toucher le CMUP (09/10/2026).
    bam = float(infra.valeur("SELECT cours_mad FROM cours_bam WHERE code_devise = 'USD' ORDER BY date_cours DESC LIMIT 1"))
    cours_ded = float(infra.valeur(f"SELECT taux_change FROM import_factures WHERE id_facture = '{id_facture}'"))
    jour = infra.valeur("SELECT to_char(current_date, 'YYYY-MM-DD')")
    paiement = {"date_paiement": jour, "montant_devise": 100, "montant_mad": round(100 * bam, 2)}
    c.refus("Magasinie", "POST", f"/api/import/factures/{id_facture}/paiements", paiement, codes=(403,))
    c.refus("Choukri", "POST", f"/api/import/factures/{id_facture}/paiements",
            dict(paiement, montant_devise=10_000_000, montant_mad=10_000_000 * bam), contient="passerait")
    cm = cmup_magasin(infra, ref)
    c.ok("Choukri", "POST", f"/api/import/factures/{id_facture}/paiements", paiement)
    verifier(abs(cmup_magasin(infra, ref) - cm) < 1e-9, "le paiement a touche le CMUP")
    cr = c.ok("Choukri", "GET", f"/api/import/dossiers/{id_dossier}/cout-revient-reel")
    ligne = next(x for x in cr["factures"] if x["id_facture"] == id_facture)
    attendu = round(100 * bam, 2) - 100 * cours_ded
    verifier(abs(float(ligne["change_annee_ded_mad"]) - attendu) < 0.05,
             f"ecart de change {ligne['change_annee_ded_mad']} au lieu de {attendu:.2f}")

    # Regle 3 (09/10) : l'avoir d'import. De prix : la valeur baisse au CMUP du stock restant.
    avoir = {"nature": "AVOIR_PRIX", "numero_piece": "AV-BANC-1", "montant_mad": 500,
             "motif": "Remise pour non-conformite gardee"}
    c.refus("Magasinie", "POST", f"/api/import/dossiers/{id_dossier}/avoir", avoir, codes=(403,))
    c.refus("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/avoir", dict(avoir, motif="non"))
    cm = cmup_magasin(infra, ref)
    ap = c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/avoir", dict(avoir, simuler=True))
    verifier(abs(ap["ecart_stock_dhs"] + 500) < 0.01, f"avoir de prix : {ap['ecart_stock_dhs']} au stock au lieu de -500")
    verifier(abs(cmup_magasin(infra, ref) - cm) < 1e-9, "l'apercu de l'avoir a ecrit")
    c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/avoir", avoir)
    verifier(abs(cmup_magasin(infra, ref) - (cm - 500 / kg(infra, ref))) < 0.0002, "l'avoir de prix n'a pas baisse le CMUP")
    # Un nouvel avoir ne rejoue pas les frais : la cloture ne lit que les FRAIS.
    nb_frais = infra.valeur(f"SELECT count(*) FROM import_ajustements_cump WHERE id_dossier = '{id_dossier}' AND origine = 'FRAIS'")

    # Pour retour : solde le retour fournisseur de la reception, l'ecart en consomme, le CMUP intact.
    c.refus("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/avoir",
            dict(avoir, nature="AVOIR_RETOUR", numero_piece="AV-BANC-2"), contient="retour")
    rim = infra.valeur(f"SELECT numero FROM import_receptions WHERE id_reception = '{rid}'")
    code, r = c.appel("Choukri", "POST", "/api/mouvements", {
        "code_type_mvt": "RETOUR_FOURN", "code_magasin": MAG, "code_motif": "RETOUR_FOUR", "reference_document": rim,
        "lignes": [{"code_reference": ref, "quantite_saisie": 50, "unite_saisie": "kg", "code_motif_ligne": "R1",
                    "lot_fournisseur": "LOT-BANC-1"}]})
    verifier(code == 200, f"retour fournisseur d'import refuse : {r}")
    cm = cmup_magasin(infra, ref)
    valeur = 50 * 2.0 * cours_ded
    retour = {"nature": "AVOIR_RETOUR", "numero_piece": "AV-BANC-2", "montant_mad": round(valeur - 20, 2),
              "motif": "Avoir pour les 50 kg rendus"}
    ap = c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/avoir", retour)
    verifier(abs(ap["valeur_retours_dhs"] - valeur) < 0.05 and abs(ap["ecart_consomme_dhs"] - 20) < 0.05,
             f"avoir pour retour : valeur {ap['valeur_retours_dhs']} / ecart {ap['ecart_consomme_dhs']}")
    verifier(abs(cmup_magasin(infra, ref) - cm) < 1e-9, "l'avoir pour retour a touche le CMUP")
    c.refus("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/avoir", dict(retour, numero_piece="AV-BANC-3"),
            contient="retour")
    detail = c.ok("Choukri", "GET", f"/api/import/dossiers/{id_dossier}")
    verifier(all(x["solde"] for x in detail.get("retours", [])) and detail.get("retours"),
             f"le retour n'est pas solde : {detail.get('retours')}")
    verifier(infra.valeur(f"SELECT count(*) FROM import_ajustements_cump WHERE id_dossier = '{id_dossier}' AND origine = 'FRAIS'")
             == nb_frais, "un avoir a ecrit des lignes d'origine FRAIS")
    verifier(controle(infra, "C10") == 0, "C10 leve malgre la derogation")


def scenario_colisage_ecran_et_base(c, infra):
    """Le controle SQL (fn_controle_colisage) rend le meme verdict que l'ecran sur les cas partages
    (cas_colisage.json, joues aussi par frontend/tests). La base ne parle que d'« incoherent »."""
    import json
    from pathlib import Path
    d = json.loads((Path(__file__).parent / "cas_colisage.json").read_text(encoding="utf-8"))
    ref = "PLA 140 CHE"
    infra.sql(f"UPDATE reference SET poids_bobine_kg = {d['poids_bobine_kg']}, "
              f"bobines_par_palette = {d['bobines_par_palette']} WHERE code_reference = '{ref}'")
    infra.sql(f"UPDATE parametre SET valeur_courante = '{d['refus_pct']}' WHERE code_parametre = 'P_ColisageTolRefusPct'")
    sql = lambda v: "NULL" if v is None else str(v)
    for cas in d["cas"]:
        msg = infra.valeur(f"SELECT COALESCE(fn_controle_colisage('{ref}', {sql(cas['kg'])}, "
                           f"{sql(cas['bobines'])}, {sql(cas['palettes'])}), '')")
        verifier(bool(msg) == (cas["attendu"] == "incoherent"),
                 f"« {cas['nom']} » : la base dit {msg or 'rien'}, l'ecran dit {cas['attendu']}")


def scenario_audit_montants(c, infra):
    """Un prix de ligne de bon modifie laisse sa trace : ancienne et nouvelle valeur, et qui (P2-11)."""
    bc = c.ok("Assistante", "POST", "/api/bons-commande", {"code_fournisseur": FRS, "lignes": [{
        "code_reference": REF, "unite_commande": "kg", "quantite_commandee_unite": 100, "prix_unitaire_devise": 20}]})
    lignes = c.ok("Assistante", "GET", f"/api/bons-commande/{bc['id_bc']}/lignes")
    lignes = lignes.get("lignes", lignes) if isinstance(lignes, dict) else lignes
    id_ligne = lignes[0]["id_ligne_bc"]
    c.ok("Assistante", "PATCH", f"/api/bons-commande/{bc['id_bc']}/lignes/{id_ligne}", {"prix_unitaire_devise": 21.5})
    trace = infra.sql(
        "SELECT a.anciennes_valeurs, a.nouvelles_valeurs, u.login FROM audit_log a "
        "LEFT JOIN utilisateur u ON u.id_utilisateur = a.id_utilisateur "
        f"WHERE a.table_concernee = 'ligne_bc' AND a.operation = 'UPDATE' AND a.id_enregistrement = '{id_ligne}' "
        "ORDER BY a.date_operation DESC LIMIT 1")
    verifier(trace, "la modification du prix n'est pas au journal")
    ancien, nouveau, qui = trace[0]
    verifier('"prix_unitaire_devise": 20' in ancien and '"prix_unitaire_devise": 21.5' in nouveau,
             f"valeurs du journal inattendues : {ancien} -> {nouveau}")
    verifier(qui == "Assistante", f"l'auteur de la modification n'est pas inscrit : {qui}")


def scenario_lots_autorisations(c, infra):
    """Une derogation se demande au droit d'ecrire sur les lots, s'accorde avec un motif, une seule fois ;
    declarer un magasin « quarantaine » demande VALIDER."""
    ref, lot = "PP-1500 Dtex-Cream 2951-Hs", "LOT-BANC-AUTO"
    # Une derogation de lot bloque est bornee en kilos (F17, 09/10).
    c.refus("Magasinie", "POST", "/api/autorisations", {
        "type_demande": "LOT_BLOQUE", "code_reference": ref, "lot_fournisseur": lot,
        "document": "MCH-BANC-0001", "motif": "Commande urgente, lot controle visuellement"}, contient="kilos")
    d = c.ok("Magasinie", "POST", "/api/autorisations", {
        "type_demande": "LOT_BLOQUE", "code_reference": ref, "lot_fournisseur": lot, "kg": 100,
        "document": "MCH-BANC-0001", "motif": "Commande urgente, lot controle visuellement"})
    idd = d["id_demande"]
    c.refus("Magasinie", "POST", f"/api/autorisations/{idd}/decider", {"decision": "ACCORDEE", "motif": "Vu avec la qualite"})
    c.refus("Choukri", "POST", f"/api/autorisations/{idd}/decider", {"decision": "ACCORDEE"})
    c.ok("Choukri", "POST", f"/api/autorisations/{idd}/decider", {"decision": "ACCORDEE", "motif": "Vu avec la qualite, une fois"})
    c.refus("Mohamed", "POST", f"/api/autorisations/{idd}/decider", {"decision": "REFUSEE", "motif": "Trop tard pour refuser"})
    # Le magasin : renommer reste une ecriture, la quarantaine une decision.
    # L'assistante ecrit sur le stock sans valider les lots.
    m = c.ok("Assistante", "GET", "/api/magasins/Polyfashions")
    c.ok("Assistante", "PATCH", "/api/magasins/Polyfashions", {"nom": m["nom"], "est_quarantaine": m["est_quarantaine"]})
    c.refus("Assistante", "PATCH", "/api/magasins/Polyfashions", {"est_quarantaine": 1}, codes=(403,))


def scenario_reception_devalidee_revalidee(c, infra):
    """Une reception validee, devalidee (ses entrees contre-passees), se corrige et se revalide :
    pas d'impasse sur le numero du mouvement ni sur l'archive (audit v3/v4)."""
    avant = kg(infra)
    id_bc, lignes = bon_envoye(c, [(REF, 600, 20)])
    rid = reception_validee(c, id_bc, lignes, [600])
    # La procedure : contre-passer l'entree, puis devalider le papier.
    numero = infra.valeur(f"SELECT numero_reception FROM reception WHERE id_reception = '{rid}'")
    for (id_mvt,) in infra.sql(f"SELECT id_mouvement FROM mouvement WHERE reference_document = '{numero}' "
                               "AND code_type_mvt = 'ENTREE_REC'"):
        c.ok("Choukri", "POST", f"/api/mouvements/{id_mvt}/contre-passer", {"motif": "Pesee a refaire, balance dereglee"})
    # U2 (09/10) : le bon revient d'une cloture, son recu se recale ; C52 signale la reception
    # validee dont l'entree est contre-passee, jusqu'a sa devalidation.
    bon = infra.sql(f"SELECT b.statut, lb.quantite_recue_kg, lb.statut FROM bon_commande b "
                    f"JOIN ligne_bc lb ON lb.id_bc = b.id_bc WHERE b.id_bc = '{id_bc}'")[0]
    verifier(bon[0] == "ENVOYE" and float(bon[1]) == 0 and bon[2] == "EN_ATTENTE",
             f"le bon n'est pas revenu de sa cloture : {bon}")
    verifier(int(infra.valeur(f"SELECT count(*) FROM v_ctl_c52 WHERE numero = '{numero}'")) == 1,
             "C52 ne voit pas la reception contre-passee")
    c.ok("Choukri", "POST", f"/api/devalider/receptions/{rid}", {"motif": "Pesee a refaire, balance dereglee"})
    verifier(int(infra.valeur(f"SELECT count(*) FROM v_ctl_c52 WHERE numero = '{numero}'")) == 0,
             "C52 garde la reception devalidee")
    verifier(abs(kg(infra) - avant) < 1e-6, "la devalidation n'a pas retire l'entree")
    # U3 (09/10) : la pesee refaite (590 kg) passe a l'historique des prix en revision, et
    # l'archive juge l'ecart sur le reste du bon, a la tolerance du fournisseur.
    id_ligne = infra.valeur(f"SELECT id_ligne_reception FROM ligne_reception WHERE id_reception = '{rid}'")
    c.ok("Choukri", "PUT", f"/api/receptions/{rid}/statut", {"statut": "BROUILLON", "motif": "Pesee a refaire au magasin"})
    c.ok("Magasinie", "PATCH", f"/api/receptions/{rid}/lignes/{id_ligne}",
         {"unite_saisie": "kg", "quantite_pesee_unite": 590})
    c.ok("Magasinie", "PUT", f"/api/receptions/{rid}/statut", {"statut": "A_CONTROLER"})
    c.ok("Choukri", "POST", f"/api/receptions/{rid}/valider")
    verifier(abs(kg(infra) - avant - 590) < 1e-6, "la revalidation n'a pas refait l'entree a 590 kg")
    courant = infra.sql(f"SELECT version, quantite_achetee_kg FROM v_historique_prix_courant "
                        f"WHERE id_ligne_reception = '{id_ligne}'")[0]
    verifier(courant[0] == "2" and abs(float(courant[1]) - 590) < 1e-6,
             f"l'historique des prix garde la premiere validation : {courant}")
    archive = infra.sql(f"SELECT ecart_pct, conformite_quantite FROM archive_reception "
                        f"WHERE id_ligne_reception = '{id_ligne}' ORDER BY version DESC LIMIT 1")[0]
    verifier(abs(float(archive[0]) + 1.6667) < 0.01 and archive[1] == "1",
             f"archive : ecart {archive[0]} (attendu -1,67 % sur 600 kg restants), conforme {archive[1]}")
    verifier(controle(infra, "C11") == 0, "C11 apres devalidation et revalidation")
    verifier(infra.valeur(f"SELECT statut FROM bon_commande WHERE id_bc = '{id_bc}'") == "CLOTURE",
             "le bon n'est pas reclos par la revalidation")


def scenario_import_coherence(c, infra):
    """Import : une ligne de bon servie par un dossier ne se recoit pas en local ; une facture recue est
    figee ; avant la DUM, contre-passer l'entree annule la reception et rend facture et bon."""
    ref = "PP-1500 Dtex-Bleu 6666-Hs"
    jour = infra.valeur("SELECT to_char(current_date, 'YYYY-MM-DD')")
    # Un taux du jour pour l'USD : un bon en devise ne se valide pas sur un taux de plus de 7 jours.
    infra.sql(f"UPDATE taux_change SET date_fin = '{jour}' WHERE code_devise = 'USD' AND date_fin IS NULL")
    infra.sql("INSERT INTO taux_change (id_taux, code_devise, taux, date_debut, source) "
              f"VALUES (gen_random_uuid()::text, 'USD', 9.30, '{jour}', 'banc')")
    id_bc, lignes = bon_envoye(c, [(ref, 1000, 2.0)], frs="FRS-001")
    lb = lignes[0]["id_ligne_bc"]
    cours = c.ok("Choukri", "GET", f"/api/import/taux-reference?devise=USD&date={jour}")["reference"]
    d = c.ok("Choukri", "POST", "/api/import/dossiers", {"numero": "BANC/27", "code_devise": "USD"})
    id_dossier = d.get("id_dossier") or d.get("id")
    f = c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/factures", {
        "code_fournisseur": "FRS-001", "numero_facture": "FB-2", "date_facture": jour,
        "code_devise": "USD", "taux_change": cours, "montant_devise": 2000})
    id_facture = f.get("id_facture") or f.get("id")
    c.ok("Choukri", "POST", f"/api/import/factures/{id_facture}/lignes", {
        "type_ligne": "ERP", "code_reference": ref, "unite": "kg", "quantite": 1000, "poids_net_kg": 1000,
        "prix_unitaire_devise": 2.0, "lot_fournisseur": "LOT-BANC-2", "id_ligne_bc": lb})
    # Etancheite : la ligne de bon servie par le dossier ne se recoit pas en local.
    c.refus("Magasinie", "POST", "/api/receptions", {"id_bc": id_bc, "lignes": [{
        "code_reference": ref, "id_ligne_bc": lb, "unite_saisie": "kg", "quantite_pesee_unite": 400,
        "code_magasin_dest": MAG, "lot_fournisseur": "LOT-BANC-2", "nb_bobines": 154}]}, contient="ETANCHEITE")

    ligne = next(x for x in c.ok("Magasinie", "GET", "/api/import/a-recevoir") if x["numero_dossier"] == "BANC/27")
    r = c.ok("Magasinie", "POST", "/api/import/receptions", {"date_reception": jour, "lignes": [{
        "id_ligne": ligne["id_ligne"], "quantite_recue_kg": 400, "code_magasin": MAG,
        "lot_fournisseur": "LOT-BANC-2", "nb_bobines": 154}]})
    rid = r["id_reception"]
    c.ok("Magasinie", "PUT", f"/api/import/receptions/{rid}/statut", {"statut": "A_CONTROLER"})
    c.ok("Choukri", "POST", f"/api/import/receptions/{rid}/valider")
    recu = lambda: float(infra.valeur(f"SELECT quantite_recue_kg FROM import_facture_lignes WHERE id_ligne = '{ligne['id_ligne']}'"))
    recu_bc = lambda: float(infra.valeur(f"SELECT quantite_recue_kg FROM ligne_bc WHERE id_ligne_bc = '{lb}'"))
    verifier(abs(recu() - 400) < 1e-6 and abs(recu_bc() - 400) < 1e-6, "la reception n'a pas servi facture et bon")

    # La facture recue est figee.
    c.refus("Choukri", "PATCH", f"/api/import/factures/{id_facture}", {"montant_devise": 2100}, contient="IMPORT-FIGEE")

    # Avant la DUM, contre-passer l'entree annule la reception et rend facture et bon.
    id_mvt = infra.valeur(f"SELECT id_mouvement FROM import_reception_lignes WHERE id_reception = '{rid}'")
    c.ok("Choukri", "POST", f"/api/mouvements/{id_mvt}/contre-passer", {"motif": "Erreur de lot, a recevoir de nouveau"})
    statut = infra.valeur(f"SELECT statut FROM import_receptions WHERE id_reception = '{rid}'")
    verifier(statut == "ANNULEE", f"la reception d'import reste {statut} apres contre-passation")
    verifier(abs(recu()) < 1e-6 and abs(recu_bc()) < 1e-6, f"facture {recu()} kg / bon {recu_bc()} kg apres contre-passation")
    # Plus rien de recu : la facture se corrige de nouveau.
    c.ok("Choukri", "PATCH", f"/api/import/factures/{id_facture}", {"montant_devise": 2100})


def taux_usd_du_jour(infra):
    jour = infra.valeur("SELECT to_char(current_date, 'YYYY-MM-DD')")
    if infra.valeur(f"SELECT count(*) FROM taux_change WHERE code_devise = 'USD' AND substr(date_debut, 1, 10) = '{jour}'") == "0":
        infra.sql(f"UPDATE taux_change SET date_fin = '{jour}' WHERE code_devise = 'USD' AND date_fin IS NULL")
        infra.sql("INSERT INTO taux_change (id_taux, code_devise, taux, date_debut, source) "
                  f"VALUES (gen_random_uuid()::text, 'USD', 9.30, '{jour}', 'banc')")
    return jour


def scenario_machine(c, infra):
    """Une machine du banc : chargement, constat ordinaire en vert, gain refuse comme consommation,
    dechargement au magasin, grand livre juste ; retiree, elle ne se charge plus."""
    ref, lot = "PP-1500 Dtex-L.Beige 44377-Hs", "LOT-MACH-1"
    jour = taux_usd_du_jour(infra)
    id_bc, lignes = bon_envoye(c, [(ref, 520, 2.0)], frs="FRS-001")
    rid = reception_validee(c, id_bc, lignes, [520], lot_fournisseur=lot, nb_bobines=200)
    stock0 = kg(infra, ref)

    c.ok("Choukri", "POST", "/api/machines", {"code_machine": "BANC1", "nom": "Machine du banc",
                                              "zones": [{"role": "ETAGE", "numero_etage": 1, "capacite_bobines": 300}]})
    zone = "BANC1-E1"

    def fiche(type_fiche, lignes, mag=MAG):
        f = c.ok("Magasinie", "POST", "/api/machines/fiches", {
            "type_fiche": type_fiche, "code_machine": "BANC1", "code_emplacement": zone, "date_fiche": jour,
            "code_magasin": mag if type_fiche != "MAJ" else None, "responsable": "Banc", "lignes": lignes})
        return f["id_fiche"]

    # 1. Chargement : 100 bobines de 2,6 kg, pleines.
    f1 = fiche("CHARGE", [{"code_reference": ref, "lot_fournisseur": lot, "nb_bobines_mouvementees": 100,
                           "poids_retenu_kg": 2.6, "pourcentage": 100, "code_motif": "CH_PRODUCTION"}])
    ap = c.ok("Magasinie", "POST", f"/api/machines/fiches/{f1}/apercu", {})
    verifier(not ap["blocages"], f"apercu du chargement bloque : {ap['blocages']}")
    # Le magasinier a VALIDER sur les mouvements (configuration reelle) : il charge.
    c.ok("Magasinie", "POST", f"/api/machines/fiches/{f1}/valider", {})
    verifier(abs(kg(infra, ref) - (stock0 - 260)) < 0.01, f"le chargement n'a pas sorti 260 kg : {stock0 - kg(infra, ref)}")

    # 1 bis. Le mouvement magasin du chargement ne se contre-passe pas seul : la
    #        machine garderait le fil (service ET base, 09/10/2026).
    id_mvt = infra.valeur("SELECT id_mouvement FROM mouvement WHERE code_type_mvt = 'CHARGE_MACHINE' "
                          "ORDER BY date_creation DESC LIMIT 1")
    c.refus("Choukri", "POST", f"/api/mouvements/{id_mvt}/contre-passer",
            {"motif": "Essai du banc : contre-passer un chargement"}, contient="fiche machine")
    refus_sql(infra, "INSERT INTO mouvement (id_mouvement, numero_mouvement, code_type_mvt, code_magasin, "
                     f"id_mouvement_contrepasse) VALUES ('banc-x', 'MVT-BANC-X', 'AJUST_INV_POS', '{MAG}', '{id_mvt}')",
              "MACHINE-ANNULATION")

    # 2. Constat ordinaire : 50 % restent, 130 kg consommes -> vert, au droit d'ecrire.
    f2 = fiche("MAJ", [{"code_reference": ref, "lot_fournisseur": lot, "nb_bobines_presentes": 100,
                        "pourcentage": 50, "code_motif": "MJ_ORDINAIRE"}])
    ap = c.ok("Magasinie", "POST", f"/api/machines/fiches/{f2}/apercu", {})
    verifier(not ap["blocages"], f"constat ordinaire bloque : {ap['blocages']}")
    verifier(all(l.get("niveau_ecart") in ("VERT", "AUCUN") for l in ap["lignes"]), f"constat ordinaire hors du vert : {ap['lignes']}")
    c.ok("Magasinie", "POST", f"/api/machines/fiches/{f2}/valider", {})

    # 3. Un gain declare comme consommation : le moteur le classe en regularisation,
    #    jamais en consommation negative (C38 reste une sentinelle a zero).
    f3 = fiche("MAJ", [{"code_reference": ref, "lot_fournisseur": lot, "nb_bobines_presentes": 100,
                        "pourcentage": 60, "code_motif": "MJ_CORRECTION", "effet_ecart": "CONSOMMATION",
                        "motif_texte": "essai du banc"}])
    ap = c.ok("Magasinie", "POST", f"/api/machines/fiches/{f3}/apercu", {})
    verifier([l.get("effet_ecart") for l in ap["lignes"]] == ["REGULARISATION"],
             f"un gain n'est pas classe en regularisation : {[(l.get('ecart_kg'), l.get('effet_ecart')) for l in ap['lignes']]}")
    # 26 kg sur une ligne de 260 : orange. Le serveur exige la confirmation.
    verifier([l.get("niveau_ecart") for l in ap["lignes"]] == ["ORANGE"], f"niveau attendu ORANGE : {ap['lignes']}")
    c.refus("Magasinie", "POST", f"/api/machines/fiches/{f3}/valider", {}, contient="ORANGE")
    c.ok("Magasinie", "POST", f"/api/machines/fiches/{f3}/annuler", {"motif": "Essai du banc"})

    # 4. Dechargement de tout au magasin : 100 bobines a 50 %.
    f4 = fiche("DECHARGE", [{"code_reference": ref, "lot_fournisseur": lot, "nb_bobines_mouvementees": 100,
                             "pct_retirees": 50, "destination": "MAGASIN", "code_motif": "DE_CHGT_PROD"}])
    ap = c.ok("Magasinie", "POST", f"/api/machines/fiches/{f4}/apercu", {})
    verifier(not ap["blocages"], f"dechargement bloque : {ap['blocages']}")
    c.ok("Magasinie", "POST", f"/api/machines/fiches/{f4}/valider", {})
    verifier(abs(kg(infra, ref) - (stock0 - 130)) < 0.01, f"stock apres dechargement : {kg(infra, ref)} au lieu de {stock0 - 130}")
    verifier(controle(infra, "C11") == 0 and controle(infra, "C38") == 0, "C11 ou C38 apres le parcours machine")

    # 5. Retiree, elle ne porte plus de fiche. Un brouillon en attente empeche
    #    d'abord le retrait (il se validerait ensuite sur une machine hors parc).
    f5 = fiche("MAJ", [{"code_reference": ref, "lot_fournisseur": lot, "nb_bobines_presentes": 0,
                        "pourcentage": 0, "code_motif": "MJ_ORDINAIRE"}])
    c.refus("Choukri", "PATCH", "/api/machines/BANC1/etat", {"etat": "RETIREE", "motif": "Fin du banc"},
            contient="brouillon")
    c.ok("Magasinie", "POST", f"/api/machines/fiches/{f5}/annuler", {"motif": "Essai du banc"})
    c.ok("Choukri", "PATCH", "/api/machines/BANC1/etat", {"etat": "RETIREE", "motif": "Fin du banc"})
    c.refus("Magasinie", "POST", "/api/machines/fiches", {
        "type_fiche": "CHARGE", "code_machine": "BANC1", "code_emplacement": zone, "date_fiche": jour,
        "code_magasin": MAG, "responsable": "Banc", "lignes": []}, contient="retiree")


def scenario_machine_surplus(c, infra):
    """Regle 2 (09/10) : a un chargement, consommer plus que ce que portait la ligne passe en ORANGE
    avec une raison choisie ; une Correction est jugee par les seuils (rouge = Direction)."""
    ref, lot = "PP-1500 Dtex-L.Beige 44377-Hs", "LOT-MACH-2"
    jour = taux_usd_du_jour(infra)
    id_bc, lignes = bon_envoye(c, [(ref, 520, 2.0)], frs="FRS-001")
    reception_validee(c, id_bc, lignes, [520], lot_fournisseur=lot, nb_bobines=200)
    c.ok("Choukri", "POST", "/api/machines", {"code_machine": "BANC2", "nom": "Machine du banc 2",
                                              "zones": [{"role": "ETAGE", "numero_etage": 1, "capacite_bobines": 300}]})
    zone = "BANC2-E1"

    def fiche(type_fiche, lignes):
        return c.ok("Magasinie", "POST", "/api/machines/fiches", {
            "type_fiche": type_fiche, "code_machine": "BANC2", "code_emplacement": zone, "date_fiche": jour,
            "code_magasin": MAG if type_fiche != "MAJ" else None, "responsable": "Banc", "lignes": lignes})["id_fiche"]

    # Ligne vide, 100 bobines de 2,6 kg chargees, 40 % declares : 156 kg « consommes » a l'instant.
    charge = {"code_reference": ref, "lot_fournisseur": lot, "nb_bobines_mouvementees": 100,
              "poids_retenu_kg": 2.6, "pourcentage": 40, "code_motif": "CH_PRODUCTION"}
    f1 = fiche("CHARGE", [charge])
    ap = c.ok("Magasinie", "POST", f"/api/machines/fiches/{f1}/apercu", {})
    verifier([l.get("niveau_ecart") for l in ap["lignes"]] == ["ORANGE"], f"surplus non orange : {ap['lignes']}")
    verifier(any("raison" in b for b in ap["blocages"]), f"surplus sans raison exigee : {ap['blocages']}")
    c.refus("Magasinie", "POST", f"/api/machines/fiches/{f1}/valider", {"confirme_orange": True}, contient="raison")
    c.ok("Magasinie", "PUT", f"/api/machines/fiches/{f1}", {
        "type_fiche": "CHARGE", "code_machine": "BANC2", "code_emplacement": zone, "date_fiche": jour,
        "code_magasin": MAG, "responsable": "Banc", "lignes": [dict(charge, motif_texte="Saisie décalée")]})
    c.refus("Magasinie", "POST", f"/api/machines/fiches/{f1}/valider", {}, contient="ORANGE")
    c.ok("Magasinie", "POST", f"/api/machines/fiches/{f1}/valider", {"confirme_orange": True})
    verifier(controle(infra, "C48") >= 1, "le chargement deja consomme n'est pas au controle C48")
    # F22 : le journal des mouvements machine porte le mouvement magasin lie ; l'apercu du
    # retrait dit l'etat auquel l'etage reviendra (vide) et le mouvement annule.
    journal = c.ok("Magasinie", "GET", "/api/machines/BANC2/mouvements")
    verifier(any(l.get("numero_mouvement") for l in journal), f"journal machine sans mouvement magasin : {journal[:1]}")
    ap = c.ok("Magasinie", "GET", f"/api/machines/fiches/{f1}/retrait-apercu")
    verifier(ap.get("derniere") is True and ap.get("etat_avant") == [] and len(ap.get("mouvements") or []) == 1,
             f"apercu du retrait inattendu : {ap}")

    # Une Correction qui se dit consommation : 104 kg -> 26 kg, 78 kg sur une ligne de 104 : rouge.
    f2 = fiche("MAJ", [{"code_reference": ref, "lot_fournisseur": lot, "nb_bobines_presentes": 100,
                        "pourcentage": 10, "code_motif": "MJ_CORRECTION", "effet_ecart": "CONSOMMATION",
                        "motif_texte": "essai du banc"}])
    ap = c.ok("Magasinie", "POST", f"/api/machines/fiches/{f2}/apercu", {})
    verifier([l.get("niveau_ecart") for l in ap["lignes"]] == ["ROUGE"],
             f"une correction de 78 kg n'est pas rouge : {ap['lignes']}")
    c.refus("Magasinie", "POST", f"/api/machines/fiches/{f2}/valider", {"confirme_orange": True}, contient="Direction")
    c.ok("Magasinie", "POST", f"/api/machines/fiches/{f2}/annuler", {"motif": "Essai du banc"})


def scenario_sessions(c, infra):
    """Mot de passe de 12 au serveur ; changer son mot de passe ferme les autres sessions et rend un
    jeton neuf ; on ne trie pas sur un champ masque (audit v4, P2-18)."""
    import time
    from banc import MOT_DE_PASSE
    c.ok("Tarik", "GET", "/api/auth/moi")
    ancien_jeton = c.jetons["Tarik"]
    time.sleep(1.2)  # le jeton date a la seconde : le changement doit lui etre posterieur
    c.refus("Tarik", "POST", "/api/auth/mot-de-passe", {"ancien": MOT_DE_PASSE, "nouveau": "Court-2026"}, contient="12")
    r = c.ok("Tarik", "POST", "/api/auth/mot-de-passe", {"ancien": MOT_DE_PASSE, "nouveau": "Nouveau-Banc-2026!"})
    verifier(r.get("jeton"), "le changement de mot de passe ne rend pas de jeton neuf")
    c.jetons["Tarik"] = ancien_jeton
    code, _ = c.appel("Tarik", "GET", "/api/auth/moi")
    verifier(code == 401, f"l'ancien jeton reste valide apres le changement de mot de passe : {code}")
    c.jetons["Tarik"] = r["jeton"]
    c.ok("Tarik", "GET", "/api/auth/moi")
    r = c.ok("Tarik", "POST", "/api/auth/mot-de-passe", {"ancien": "Nouveau-Banc-2026!", "nouveau": MOT_DE_PASSE})
    c.jetons["Tarik"] = r["jeton"]
    # Le prix catalogue est masque au magasinier : ni tri, ni filtre dessus.
    c.refus("Magasinie", "GET", "/api/catalogue?tri=prix_catalogue", contient="masque")
    # T8 (09/10) : l'ecran verrouille compte les echecs comme la connexion ; un bon mot de
    # passe ne passe pas tant que le compte est bloque.
    for _ in range(2):
        c.refus("Tarik", "POST", "/api/auth/deverrouiller", {"mot_de_passe": "pas-le-bon-mot"}, codes=(401,))
    c.refus("Tarik", "POST", "/api/auth/deverrouiller", {"mot_de_passe": "pas-le-bon-mot"}, codes=(429,))
    c.refus("Tarik", "POST", "/api/auth/deverrouiller", {"mot_de_passe": MOT_DE_PASSE}, codes=(429,))
    infra.sql("UPDATE utilisateur SET echecs_consecutifs = 0, bloque_jusqu_a = NULL WHERE login = 'Tarik'")
    c.ok("Tarik", "POST", "/api/auth/deverrouiller", {"mot_de_passe": MOT_DE_PASSE})


def scenario_concurrence_numerotation(c, infra):
    """Huit bons crees en meme temps : huit numeros distincts, aucun conflit (compteur, audit v4 P2-19)."""
    from concurrent.futures import ThreadPoolExecutor
    c.ok("Assistante", "GET", "/api/auth/moi")  # jeton pris avant la rafale
    corps = {"code_fournisseur": FRS, "lignes": [{"code_reference": REF, "unite_commande": "kg",
                                                  "quantite_commandee_unite": 10, "prix_unitaire_devise": 20}]}
    with ThreadPoolExecutor(max_workers=8) as pool:
        reponses = list(pool.map(lambda _: c.appel("Assistante", "POST", "/api/bons-commande", corps), range(8)))
    codes = [code for code, _ in reponses]
    verifier(all(code == 200 for code in codes), f"creation simultanee : codes {codes} {[r for _, r in reponses if _ != 200][:1]}")
    numeros = [r["numero_bc"] for _, r in reponses]
    verifier(len(set(numeros)) == 8, f"numeros en double : {sorted(numeros)}")


def scenario_sortie_hors_machine(c, infra):
    """Regle 1 (09/10) : sortie hors machine avec motif par ligne et OF libre, pret a une autre usine
    rendu en nature, seuil de 50 kg cumule par jour et par reference (dechets compris)."""
    ref = "PLA 50 CHE"
    entree_stock(c, ref, 300)
    hm = lambda login, kg, motif_ligne, **x: mouvement(c, login, "SORTIE_HORS_MACHINE", [(ref, kg)],
                                                       motif="HORS_MACHINE", motif_ligne=motif_ligne, **x)
    code, r = hm("Magasinie", 10, None)
    verifier(code in (400, 422), f"sortie hors machine sans motif acceptee : {code} {r}")
    code, r = hm("Magasinie", 10, "HM_ECHANTILLON")
    verifier(code == 200, f"echantillon de 10 kg sans OF refuse : {r}")
    code, r = hm("Magasinie", 15, "HM_PRET")
    verifier(code in (400, 422) and "usine" in str(r).lower(), f"pret sans usine accepte : {code} {r}")
    code, r = hm("Magasinie", 15, "HM_PRET", tiers="Usine du banc")
    verifier(code == 200, f"pret de 15 kg refuse : {r}")
    # 10 + 15 deja sortis ce jour : un dechet de 30 kg passe le seuil cumule.
    code, r = mouvement(c, "Magasinie", "SORTIE_PROD", [(ref, 30)], numero_of="OF-BANC")
    verifier(code == 422 and "ce jour" in str(r), f"seuil cumule non applique : {code} {r}")
    code, r = mouvement(c, "Choukri", "SORTIE_PROD", [(ref, 30)], numero_of="OF-BANC")
    verifier(code == 200, f"la Direction ne passe pas le seuil : {r}")
    # L'ancienne consommation hors machine renvoie vers la sortie hors machine.
    code, r = mouvement(c, "Magasinie", "SORTIE_PROD", [(ref, 5)], numero_of="OF-BANC", nature_sortie="CONSOMMATION")
    verifier(code == 422 and "hors machine" in str(r).lower(), f"ancienne consommation acceptee : {code} {r}")
    # Le pret revient en nature, pas plus qu'il n'en est parti.
    verifier(float(infra.valeur(f"SELECT reste_kg FROM v_prets_en_cours WHERE tiers = 'Usine du banc' "
                                f"AND code_reference = '{ref}'")) == 15, "le pret n'est pas a rendre")
    code, r = mouvement(c, "Magasinie", "RETOUR_PRET", [(ref, 20)], motif="PRET", tiers="Usine du banc")
    verifier(code == 422, f"retour au-dela du pret accepte : {code} {r}")
    code, r = mouvement(c, "Magasinie", "RETOUR_PRET", [(ref, 15)], motif="PRET", tiers="Usine du banc")
    verifier(code == 200, f"retour du pret refuse : {r}")
    verifier(infra.valeur("SELECT count(*) FROM v_prets_en_cours WHERE tiers = 'Usine du banc'") == "0",
             "le pret rendu reste en cours")
    verifier(controle(infra, "C11") == 0 and controle(infra, "C47") == 0, "C11 ou C47 apres les sorties hors machine")


def scenario_controle_reception(c, infra):
    """Regle 4 (09/10) : au controle la pesee est figee ; le controleur renvoie au magasinier avec un
    motif ; celui qui a pese en dernier ne valide pas ; les corrections sont au journal ; la derogation
    se pose sur une ligne existante."""
    id_bc, lignes = bon_envoye(c, [(REF, 1000, 20.0)])
    lb = lignes[0]
    r = c.ok("Magasinie", "POST", "/api/receptions", {"id_bc": id_bc, "num_bon_livraison": "BL-CTL", "lignes": [
        {"code_reference": REF, "id_ligne_bc": lb["id_ligne_bc"], "unite_saisie": "kg",
         "quantite_pesee_unite": 990, "code_magasin_dest": MAG}]})
    rid = r["id_reception"]
    ligne = infra.valeur(f"SELECT id_ligne_reception FROM ligne_reception WHERE id_reception = '{rid}'")
    c.ok("Magasinie", "PUT", f"/api/receptions/{rid}/statut", {"statut": "A_CONTROLER"})
    # Au controle : la pesee est figee, la qualite non.
    c.refus("Choukri", "PATCH", f"/api/receptions/{rid}/lignes/{ligne}", {"quantite_pesee_unite": 980},
            contient="figee")
    c.ok("Choukri", "PATCH", f"/api/receptions/{rid}/lignes/{ligne}", {"statut_qualite": "CONFORME"})
    # Le renvoi exige un motif.
    c.refus("Choukri", "PUT", f"/api/receptions/{rid}/statut", {"statut": "BROUILLON"}, contient="corriger")
    c.ok("Choukri", "PUT", f"/api/receptions/{rid}/statut", {"statut": "BROUILLON", "motif": "Repeser : 980 kg au BL"})
    verifier(infra.valeur(f"SELECT motif_renvoi FROM reception WHERE id_reception = '{rid}'") == "Repeser : 980 kg au BL",
             "le motif du renvoi n'est pas garde")
    # Un excedent au-dela de la tolerance se pose avec sa derogation, sur la ligne existante.
    c.refus("Magasinie", "PATCH", f"/api/receptions/{rid}/lignes/{ligne}", {"quantite_pesee_unite": 1100})
    c.ok("Magasinie", "PATCH", f"/api/receptions/{rid}/lignes/{ligne}",
         {"quantite_pesee_unite": 1100, "derogation_ecart": True, "motif_derogation": "Excedent accepte par l'acheteur"})
    c.ok("Magasinie", "PATCH", f"/api/receptions/{rid}/lignes/{ligne}", {"quantite_pesee_unite": 980, "derogation_ecart": False})
    # Choukri corrige lui-meme en brouillon : il devient le dernier peseur et ne valide plus.
    c.ok("Choukri", "PATCH", f"/api/receptions/{rid}/lignes/{ligne}", {"quantite_pesee_unite": 981})
    c.ok("Magasinie", "PUT", f"/api/receptions/{rid}/statut", {"statut": "A_CONTROLER"})
    c.refus("Choukri", "POST", f"/api/receptions/{rid}/valider", contient="pese")
    c.ok("Mohamed", "POST", f"/api/receptions/{rid}/valider")
    # Regle 6 : 981 kg sur 1 000, dans la tolerance de 2 % -> ligne soldee, bon clos.
    verifier(infra.valeur(f"SELECT statut FROM ligne_bc WHERE id_ligne_bc = '{lb['id_ligne_bc']}'") == "SOLDE",
             "le reliquat dans la tolerance n'a pas solde la ligne")
    verifier(infra.valeur(f"SELECT statut FROM bon_commande WHERE id_bc = '{id_bc}'") == "CLOTURE",
             "le bon entierement solde n'est pas clos")
    verifier(int(infra.valeur("SELECT count(*) FROM audit_log WHERE table_concernee = 'ligne_reception' "
                              f"AND operation = 'UPDATE' AND id_enregistrement = '{ligne}'")) >= 3,
             "les corrections de pesee ne sont pas au journal")


def scenario_retour_cloture_avoirs(c, infra):
    """Regle 3 (09/10) : la cloture tient compte des retours (facture nette ou brute), l'avoir pour
    retour ne touche pas le CMUP, l'avoir de prix ne fait jamais passer le CMUP sous zero (U6)."""
    ref, mag = "PLA 140 CHE", "Polyfashions"

    def reception_et_retour(bl):
        id_bc, lignes = bon_envoye(c, [(ref, 1000, 20.0)])
        rid = reception_validee(c, id_bc, lignes, [1000], mag=mag)
        numero = infra.valeur(f"SELECT numero_reception FROM reception WHERE id_reception = '{rid}'")
        code, r = mouvement(c, "Choukri", "RETOUR_FOURN", [(ref, 200)], mag=mag, motif="RETOUR_FOUR",
                            motif_ligne="R1", reference_document=numero)
        verifier(code == 200, f"retour de 200 kg refuse : {r}")
        return rid

    # 1. Facture NETTE : 800 kg x 20 = 16 000 ; aucun ecart, le CMUP reste a 20.
    rid = reception_et_retour("BL-NET")
    cm0 = cmup_magasin(infra, ref, mag)
    c.refus("Choukri", "POST", f"/api/receptions/{rid}/cloturer",
            {"numero_facture": "F-NET", "montant_facture": 16000}, contient="RETOURS")
    ap = c.ok("Choukri", "POST", f"/api/receptions/{rid}/cloturer",
              {"numero_facture": "F-NET", "montant_facture": 16000, "facture_nette": True})
    verifier(abs(ap["difference_mad"]) < 0.01, f"facture nette : difference {ap['difference_mad']} au lieu de 0")
    verifier(abs(cmup_magasin(infra, ref, mag) - cm0) < 0.0002, "facture nette : le CMUP a bouge")
    c.refus("Choukri", "POST", f"/api/receptions/{rid}/avoir",
            {"nature": "AVOIR_RETOUR", "numero_piece": "AV-R0", "montant_mad": 4000, "motif": "Retour deja deduit"},
            contient="retour")

    # 2. Facture BRUTE (20 000), puis avoir pour retour a 21 MAD/kg : rien au CMUP, 200 MAD de gain en ecart.
    rid = reception_et_retour("BL-BRUT")
    cm0 = cmup_magasin(infra, ref, mag)
    ap = c.ok("Choukri", "POST", f"/api/receptions/{rid}/cloturer",
              {"numero_facture": "F-BRUT", "montant_facture": 20000, "facture_nette": False})
    verifier(abs(ap["difference_mad"]) < 0.01, f"facture brute : difference {ap['difference_mad']} au lieu de 0")
    av = c.ok("Choukri", "POST", f"/api/receptions/{rid}/avoir",
              {"nature": "AVOIR_RETOUR", "numero_piece": "AV-R1", "montant_mad": 4200, "motif": "Avoir du retour R1"})
    verifier(abs(av["ecart_prix_mad"] + 200) < 0.01, f"avoir pour retour : ecart {av['ecart_prix_mad']} au lieu de -200")
    verifier(abs(cmup_magasin(infra, ref, mag) - cm0) < 0.0002, "l'avoir pour retour a touche le CMUP")
    c.refus("Choukri", "POST", f"/api/receptions/{rid}/avoir",
            {"nature": "AVOIR_RETOUR", "numero_piece": "AV-R2", "montant_mad": 4200, "motif": "Deuxieme fois"},
            contient="retour")

    # 3. U6 : un avoir de prix plus gros que la valeur du stock restant -> CMUP a zero, reste en ecart.
    av = c.ok("Choukri", "POST", f"/api/receptions/{rid}/avoir",
              {"nature": "AVOIR", "numero_piece": "AV-X", "montant_mad": 90000, "motif": "Essai d'avoir enorme",
               "code_reference": ref})
    verifier(cmup_magasin(infra, ref, mag) >= 0, "le CMUP est passe sous zero")
    total = float(infra.valeur(f"SELECT sum(montant_mad) FROM reception_ajustements_cmup WHERE id_reception = '{rid}' "
                               "AND numero_piece = 'AV-X'"))
    verifier(abs(total + 90000) < 0.05, f"l'avoir de 90 000 n'est pas entierement journalise : {total}")
    verifier(controle(infra, "C11") == 0, "C11 apres les avoirs")


def scenario_taux_bon(c, infra):
    """Regle 10 (09/10) : le taux d'un bon en devise est propose au cours du jour de la validation,
    modifiable avec un motif (au-dela de 3 % du cours BAM, a confirmer), puis fige et justifie."""
    taux_usd_du_jour(infra)
    ref = "PP-1500 Dtex-L.Beige 44377-Hs"

    def bon_soumis():
        bc = c.ok("Assistante", "POST", "/api/bons-commande", {
            "code_fournisseur": "FRS-001",
            "lignes": [{"code_reference": ref, "unite_commande": "kg", "quantite_commandee_unite": 100,
                        "prix_unitaire_devise": 2.0}]})
        c.ok("Assistante", "PUT", f"/api/bons-commande/{bc['id_bc']}/statut", {"statut": "EN_ATTENTE_VALIDATION"})
        return bc["id_bc"]

    # Au cours propose : source REFERENCE, date du cours posee.
    b1 = bon_soumis()
    entete = next(b for b in c.ok("Choukri", "GET", "/api/bons-commande") if b["id_bc"] == b1)
    verifier(abs(float(entete.get("taux_du_jour") or 0) - 9.30) < 1e-6, f"taux du jour non propose : {entete.get('taux_du_jour')}")
    c.ok("Choukri", "PUT", f"/api/bons-commande/{b1}/statut", {"statut": "VALIDE"})
    ligne = infra.sql(f"SELECT taux_change_engage, source_taux_engage, date_cours_engage FROM bon_commande WHERE id_bc = '{b1}'")[0]
    verifier(abs(float(ligne[0]) - 9.30) < 1e-6 and ligne[1] == "REFERENCE" and ligne[2],
             f"taux engage au cours propose mal justifie : {ligne}")

    # Un autre taux : motif obligatoire ; au-dela de 3 %, a confirmer.
    b2 = bon_soumis()
    c.refus("Choukri", "PUT", f"/api/bons-commande/{b2}/statut", {"statut": "VALIDE", "taux_saisi": 9.95},
            contient="pourquoi")
    c.refus("Choukri", "PUT", f"/api/bons-commande/{b2}/statut",
            {"statut": "VALIDE", "taux_saisi": 12.0, "motif_taux": "Cours de la banque"}, contient="TAUX-ECART")
    c.ok("Choukri", "PUT", f"/api/bons-commande/{b2}/statut",
         {"statut": "VALIDE", "taux_saisi": 9.95, "motif_taux": "Cours confirme par la banque"})
    ligne = infra.sql(f"SELECT taux_change_engage, source_taux_engage, motif_taux_engage FROM bon_commande WHERE id_bc = '{b2}'")[0]
    verifier(abs(float(ligne[0]) - 9.95) < 1e-6 and ligne[1] == "SAISI" and ligne[2],
             f"taux saisi mal enregistre : {ligne}")


def scenario_plan_detail(c, infra):
    """F16 et U8 (09/10) : le calcul d'une proposition se lit pas a pas et tombe juste ; un dossier
    d'import en brouillon n'est pas de l'en-cours ; C28 dit ce que fait le reglage."""
    ref = "PP-1500 Dtex-Cream 2951-Hs"
    from urllib.parse import quote
    d = c.ok("Choukri", "GET", f"/api/plan-achat/detail?reference={quote(ref)}")
    k = d["calcul"]
    projete = k["stock_magasin_net_kg"] + k["stock_machine_compte_kg"] + k["encours_kg"] - k["demande_delai_kg"]
    verifier(abs(max(0.0, projete) - k["residuel_kg"]) < 0.01,
             f"le detail ne retombe pas sur le residuel : {projete:.2f} contre {k['residuel_kg']}")
    besoin = max(0.0, k["sorties_fenetre_kg"] + k["securite_kg"] - k["residuel_kg"],
                 k["stock_min_catalogue_kg"] - k["residuel_kg"])
    verifier(besoin <= k["besoin_avant_arrondi_kg"] + 0.01, f"besoin {besoin:.2f} > {k['besoin_avant_arrondi_kg']}")
    c.refus("Choukri", "GET", "/api/plan-achat/detail?reference=INCONNUE-XYZ", codes=(404,))

    def au_port():
        return float(infra.valeur(f"SELECT COALESCE((SELECT encours_import_kg FROM v_encours_fiable "
                                  f"WHERE code_reference = '{ref}'), 0)"))

    avant = au_port()
    aujourdhui = infra.valeur("SELECT to_char(current_date, 'YYYY-MM-DD')")
    cours = c.ok("Choukri", "GET", f"/api/import/taux-reference?devise=USD&date={aujourdhui}")["reference"]
    dossier = c.ok("Choukri", "POST", "/api/import/dossiers", {"numero": "BANC/PORT", "code_devise": "USD"})
    id_dossier = dossier.get("id_dossier") or dossier.get("id")
    f = c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/factures", {
        "code_fournisseur": "FRS-001", "numero_facture": "FB-PORT", "date_facture": aujourdhui,
        "code_devise": "USD", "taux_change": cours, "montant_devise": 600})
    c.ok("Choukri", "POST", f"/api/import/factures/{f.get('id_facture') or f.get('id')}/lignes", {
        "type_ligne": "ERP", "code_reference": ref, "unite": "kg", "quantite": 300, "poids_net_kg": 300,
        "prix_unitaire_devise": 2.0, "lot_fournisseur": "LOT-PORT-1"})
    verifier(abs(au_port() - avant) < 1e-6, "un dossier d'import en brouillon compte dans l'en-cours")
    c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/valider")
    verifier(abs(au_port() - avant - 300) < 1e-6, f"le dossier engage ne compte pas au port : {au_port() - avant}")

    infra.sql("UPDATE parametre SET valeur_courante = '1' WHERE code_parametre = 'P_EncoursRetardInclus'")
    verifier("toujours comptee" in infra.valeur("SELECT controle FROM v_controles WHERE code = 'C28'"),
             "C28 dit « retiree » alors que le retard est compte")
    infra.sql("UPDATE parametre SET valeur_courante = '0' WHERE code_parametre = 'P_EncoursRetardInclus'")
    verifier("retiree" in infra.valeur("SELECT controle FROM v_controles WHERE code = 'C28'"), "C28 ne suit pas le reglage")
    infra.sql("UPDATE parametre SET valeur_courante = '1' WHERE code_parametre = 'P_EncoursRetardInclus'")


def scenario_derogation_bornee(c, infra):
    """F17 (09/10) : la derogation d'un lot bloque couvre les kilos d'une fiche, pas plus ; elle tombe
    avec la fiche annulee ; la validation l'emploie lot par lot."""
    ref, lot = "PP-1500 Dtex-L.Beige 44377-Hs", "LOT-DERO-1"
    jour = taux_usd_du_jour(infra)
    id_bc, lignes = bon_envoye(c, [(ref, 520, 2.0)], frs="FRS-001")
    reception_validee(c, id_bc, lignes, [520], lot_fournisseur=lot, nb_bobines=200)
    c.ok("Choukri", "POST", "/api/lots/statut", {"code_reference": ref, "lot_fournisseur": lot,
                                                 "action": "BLOQUER", "motif": "Nuance douteuse, essai du banc"})
    c.ok("Choukri", "POST", "/api/machines", {"code_machine": "BANCD", "nom": "Machine des derogations",
                                              "zones": [{"role": "ETAGE", "numero_etage": 1, "capacite_bobines": 300}]})

    def fiche():
        f = c.ok("Magasinie", "POST", "/api/machines/fiches", {
            "type_fiche": "CHARGE", "code_machine": "BANCD", "code_emplacement": "BANCD-E1", "date_fiche": jour,
            "code_magasin": MAG, "responsable": "Banc",
            "lignes": [{"code_reference": ref, "lot_fournisseur": lot, "nb_bobines_mouvementees": 100,
                        "poids_retenu_kg": 2.6, "pourcentage": 100, "code_motif": "CH_PRODUCTION"}]})
        return f["id_fiche"], infra.valeur(f"SELECT numero_fiche FROM machine_fiche WHERE id_fiche = '{f['id_fiche']}'")

    def demander(numero, kg):
        d = c.ok("Magasinie", "POST", "/api/autorisations", {
            "type_demande": "LOT_BLOQUE", "code_reference": ref, "lot_fournisseur": lot, "kg": kg,
            "document": numero, "motif": "Commande urgente, nuance acceptee par le client"})
        c.ok("Choukri", "POST", f"/api/autorisations/{d['id_demande']}/decider",
             {"decision": "ACCORDEE", "motif": "Vu avec la qualite pour cette fiche"})
        return d["id_demande"]

    f1, n1 = fiche()
    ap = c.ok("Magasinie", "POST", f"/api/machines/fiches/{f1}/apercu", {})
    verifier(any("LOT-BLOQUE" in b for b in map(str, ap["blocages"])), f"lot bloque non refuse : {ap['blocages']}")
    verifier([abs(float(x["kg"]) - 260) < 0.01 for x in ap["derogations"]] == [True],
             f"la derogation proposee ne porte pas les 260 kg de la fiche : {ap['derogations']}")
    # Accordee pour 200 kg : la fiche en charge 260, refusee ; la base aussi.
    d1 = demander(n1, 200)
    c.refus("Magasinie", "POST", f"/api/machines/fiches/{f1}/valider", {}, contient="DEROGATION-KG")
    # La fiche remplacee emporte sa derogation.
    c.ok("Magasinie", "POST", f"/api/machines/fiches/{f1}/annuler", {"motif": "Fiche refaite, essai du banc"})
    verifier(infra.valeur(f"SELECT statut FROM demande_autorisation WHERE id_demande = '{d1}'") == "ANNULEE",
             "la derogation d'une fiche annulee reste accordee")
    # La nouvelle fiche, sa derogation a la bonne mesure : le chargement passe et l'emploie.
    f2, n2 = fiche()
    d2 = demander(n2, 260)
    avant = kg(infra, ref)
    c.ok("Magasinie", "POST", f"/api/machines/fiches/{f2}/valider", {})
    verifier(abs(avant - kg(infra, ref) - 260) < 0.01, "le chargement derogatoire n'a pas sorti 260 kg")
    ligne = infra.sql(f"SELECT date_consommation IS NOT NULL, kg_consommes FROM demande_autorisation WHERE id_demande = '{d2}'")[0]
    verifier(ligne[0] in (True, "t") and abs(float(ligne[1]) - 260) < 0.01, f"derogation non employee : {ligne}")
    verifier(controle(infra, "C11") == 0, "C11 apres le chargement derogatoire")


def scenario_machine_constat(c, infra):
    """F19 (09/10) : une fiche ne rajeunit que les lignes qu'elle touche ; C36 voit l'etage dont une
    ligne n'a pas ete constatee depuis P_JoursInventMachine ; C35 l'estimation hors tolerance."""
    ref = "PP-1500 Dtex-L.Beige 44377-Hs"
    jour = taux_usd_du_jour(infra)
    for lot in ("LOT-CST-1", "LOT-CST-2"):
        id_bc, lignes = bon_envoye(c, [(ref, 260, 2.0)], frs="FRS-001")
        reception_validee(c, id_bc, lignes, [260], lot_fournisseur=lot, nb_bobines=100)
    c.ok("Choukri", "POST", "/api/machines", {"code_machine": "BANC3", "nom": "Machine des constats",
                                              "zones": [{"role": "ETAGE", "numero_etage": 1, "capacite_bobines": 300}]})
    zone = "BANC3-E1"

    def valider(type_fiche, lignes):
        f = c.ok("Magasinie", "POST", "/api/machines/fiches", {
            "type_fiche": type_fiche, "code_machine": "BANC3", "code_emplacement": zone, "date_fiche": jour,
            "code_magasin": MAG if type_fiche != "MAJ" else None, "responsable": "Banc", "lignes": lignes})
        c.ok("Magasinie", "POST", f"/api/machines/fiches/{f['id_fiche']}/valider", {})

    def date_de(lot):
        return infra.valeur(f"SELECT substr(date_constat, 1, 10) FROM machine_etat "
                            f"WHERE code_emplacement = '{zone}' AND lot_fournisseur = '{lot}'")

    valider("CHARGE", [{"code_reference": ref, "lot_fournisseur": "LOT-CST-1", "nb_bobines_mouvementees": 50,
                        "poids_retenu_kg": 2.6, "pourcentage": 100, "code_motif": "CH_PRODUCTION"}])
    c36 = controle(infra, "C36")
    infra.sql(f"UPDATE machine_etat SET date_constat = '2026-01-05' WHERE code_emplacement = '{zone}'")
    verifier(controle(infra, "C36") == c36 + 1, "C36 ne voit pas l'etage constate en janvier")
    # Charger un autre lot ne rajeunit pas le premier.
    valider("CHARGE", [{"code_reference": ref, "lot_fournisseur": "LOT-CST-2", "nb_bobines_mouvementees": 20,
                        "poids_retenu_kg": 2.6, "pourcentage": 100, "code_motif": "CH_PRODUCTION"}])
    verifier(date_de("LOT-CST-1") == "2026-01-05", f"le lot non touche a pris la date de la fiche : {date_de('LOT-CST-1')}")
    verifier(date_de("LOT-CST-2") == jour, f"le lot charge n'a pas la date de la fiche : {date_de('LOT-CST-2')}")
    verifier(controle(infra, "C36") == c36 + 1, "C36 a oublie l'etage apres un chargement partiel")
    # Le constat du premier lot le rajeunit : l'etage sort de C36.
    valider("MAJ", [{"code_reference": ref, "lot_fournisseur": "LOT-CST-1", "nb_bobines_presentes": 50,
                     "pourcentage": 100, "code_motif": "MJ_ORDINAIRE"}])
    verifier(date_de("LOT-CST-1") == jour, "le constat n'a pas rajeuni la ligne constatee")
    verifier(controle(infra, "C36") == c36, "C36 garde l'etage tout juste constate")
    # C35 : un poids par bobine a 20 % du catalogue.
    c35 = controle(infra, "C35")
    infra.sql(f"UPDATE machine_etat SET poids_unitaire_kg = poids_unitaire_kg * 1.2 "
              f"WHERE code_emplacement = '{zone}' AND lot_fournisseur = 'LOT-CST-2'")
    verifier(controle(infra, "C35") == c35 + 1, "C35 ne voit pas une estimation a +20 %")


def scenario_lots_vivants(c, infra):
    """F21 et U10 (09/10) : un lot solde qui recoit se rouvre ; un lot qui tourne sur machine ne se
    solde pas ; une demande en attente ne se cree qu'une fois ; le plancher du lot laisse une trace ;
    C51 compte le fil sans lot d'une reference suivie."""
    ref, lot = "PP-1500 Dtex-L.Beige 44377-Hs", "LOT-VIV-1"
    jour = taux_usd_du_jour(infra)
    id_bc, lignes = bon_envoye(c, [(ref, 130, 2.0)], frs="FRS-001")
    reception_validee(c, id_bc, lignes, [130], lot_fournisseur=lot, nb_bobines=50)
    verifier(infra.valeur("SELECT count(*) FROM v_controles WHERE code = 'C51'") == "1", "C51 absent de v_controles")

    # Sur machine, le lot ne se solde pas.
    c.ok("Choukri", "POST", "/api/machines", {"code_machine": "BANCL", "nom": "Machine des lots",
                                              "zones": [{"role": "ETAGE", "numero_etage": 1, "capacite_bobines": 300}]})
    f = c.ok("Magasinie", "POST", "/api/machines/fiches", {
        "type_fiche": "CHARGE", "code_machine": "BANCL", "code_emplacement": "BANCL-E1", "date_fiche": jour,
        "code_magasin": MAG, "responsable": "Banc",
        "lignes": [{"code_reference": ref, "lot_fournisseur": lot, "nb_bobines_mouvementees": 10,
                    "poids_retenu_kg": 2.6, "pourcentage": 100, "code_motif": "CH_PRODUCTION"}]})
    c.ok("Magasinie", "POST", f"/api/machines/fiches/{f['id_fiche']}/valider", {})
    decision = {"code_reference": ref, "lot_fournisseur": lot, "decision": "SOLDER", "motif": "Lot dormant, essai du banc"}
    c.refus("Choukri", "POST", "/api/lots/dormant", decision, contient="LOT-MACHINE")
    # Meme par une ecriture directe, il garde son statut.
    infra.sql(f"UPDATE lot SET statut = 'SOLDE' WHERE code_reference = '{ref}' AND lot_fournisseur = '{lot}'")
    verifier(infra.valeur(f"SELECT statut FROM lot WHERE code_reference = '{ref}' AND lot_fournisseur = '{lot}'") == "LIBRE",
             "un lot qui tourne sur machine est passe SOLDE")

    # Decharge, puis solde : le lot est vide au magasin et sur machine.
    f = c.ok("Magasinie", "POST", "/api/machines/fiches", {
        "type_fiche": "DECHARGE", "code_machine": "BANCL", "code_emplacement": "BANCL-E1", "date_fiche": jour,
        "code_magasin": MAG, "responsable": "Banc",
        "lignes": [{"code_reference": ref, "lot_fournisseur": lot, "nb_bobines_mouvementees": 10,
                    "pct_retirees": 100, "destination": "MAGASIN", "code_motif": "DE_CHGT_PROD"}]})
    c.ok("Magasinie", "POST", f"/api/machines/fiches/{f['id_fiche']}/valider", {})
    c.ok("Choukri", "POST", "/api/lots/dormant", decision)
    verifier(infra.valeur(f"SELECT statut FROM lot WHERE code_reference = '{ref}' AND lot_fournisseur = '{lot}'") == "SOLDE",
             "le lot vide ne s'est pas solde")
    # Il recoit : il se rouvre, avec son evenement.
    code, r = c.appel("Choukri", "POST", "/api/mouvements", {
        "code_type_mvt": "AJUST_INV_POS", "code_magasin": MAG, "code_motif": "INVENTAIRE",
        "lignes": [{"code_reference": ref, "quantite_saisie": 5, "unite_saisie": "kg", "lot_fournisseur": lot,
                    "code_motif_ligne": "R1"}]})
    verifier(code == 200, f"ajustement sur le lot solde refuse : {r}")
    verifier(infra.valeur(f"SELECT statut FROM lot WHERE code_reference = '{ref}' AND lot_fournisseur = '{lot}'") == "LIBRE",
             "le lot solde qui recoit est reste SOLDE")
    verifier(int(infra.valeur(f"SELECT count(*) FROM lot_evenement WHERE code_reference = '{ref}' "
                              f"AND lot_fournisseur = '{lot}' AND type_evenement = 'REOUVERTURE'")) == 1,
             "pas d'evenement REOUVERTURE")

    # Le plancher laisse une trace (ecriture directe, puis le solde reel est remis : C15).
    solde = infra.valeur(f"SELECT quantite_kg FROM stock_lot WHERE code_reference = '{ref}' "
                         f"AND lot_fournisseur = '{lot}' AND code_magasin = '{MAG}'")
    infra.sql(f"UPDATE stock_lot SET quantite_kg = -2 WHERE code_reference = '{ref}' AND lot_fournisseur = '{lot}' "
              f"AND code_magasin = '{MAG}'")
    verifier(int(infra.valeur(f"SELECT count(*) FROM lot_evenement WHERE lot_fournisseur = '{lot}' "
                              f"AND type_evenement = 'PLANCHER'")) == 1, "le plancher n'a rien inscrit")
    infra.sql(f"UPDATE stock_lot SET quantite_kg = {solde} WHERE code_reference = '{ref}' AND lot_fournisseur = '{lot}' "
              f"AND code_magasin = '{MAG}'")

    # Deux demandes identiques : une seule en attente.
    demande = {"type_demande": "LOT_BLOQUE", "code_reference": ref, "lot_fournisseur": lot, "kg": 10,
               "document": "MCH-BANC-DOUBLE", "motif": "Essai de double demande"}
    d1 = c.ok("Magasinie", "POST", "/api/autorisations", demande)
    d2 = c.ok("Magasinie", "POST", "/api/autorisations", demande)
    verifier(d1["id_demande"] == d2["id_demande"] and d2.get("reprise"), f"demande creee deux fois : {d1} {d2}")


def scenario_import_bon_envoye(c, infra):
    """U1 (09/10) : une ligne de facture d'import ne vise qu'un bon envoye, du meme fournisseur et de la
    meme reference ; la liste des lignes a facturer ne propose pas une ligne deja servie."""
    ref = "PP-1500 Dtex-Cream 2951-Hs"
    taux_usd_du_jour(infra)
    aujourdhui = infra.valeur("SELECT to_char(current_date, 'YYYY-MM-DD')")
    cours = c.ok("Choukri", "GET", f"/api/import/taux-reference?devise=USD&date={aujourdhui}")["reference"]
    d = c.ok("Choukri", "POST", "/api/import/dossiers", {"numero": "BANC/BON", "code_devise": "USD"})
    f = c.ok("Choukri", "POST", f"/api/import/dossiers/{d.get('id_dossier') or d.get('id')}/factures", {
        "code_fournisseur": "FRS-001", "numero_facture": "FB-BON", "date_facture": aujourdhui,
        "code_devise": "USD", "taux_change": cours, "montant_devise": 200})
    id_facture = f.get("id_facture") or f.get("id")
    brouillon = c.ok("Assistante", "POST", "/api/bons-commande", {
        "code_fournisseur": "FRS-001",
        "lignes": [{"code_reference": ref, "unite_commande": "kg", "quantite_commandee_unite": 100, "prix_unitaire_devise": 2.0}]})
    ligne_brouillon = infra.valeur(f"SELECT id_ligne_bc FROM ligne_bc WHERE id_bc = '{brouillon['id_bc']}'")
    base = {"type_ligne": "ERP", "code_reference": ref, "unite": "kg", "quantite": 100, "poids_net_kg": 100,
            "prix_unitaire_devise": 2.0, "lot_fournisseur": "LOT-BON-1"}
    c.refus("Choukri", "POST", f"/api/import/factures/{id_facture}/lignes", dict(base, id_ligne_bc=ligne_brouillon),
            contient="IMPORT-BC")
    id_bc, lignes = bon_envoye(c, [(ref, 100, 2.0)], frs="FRS-001")
    autre = infra.valeur("SELECT code_reference FROM reference WHERE actif = 1 AND code_reference <> "
                         f"'{ref}' ORDER BY code_reference LIMIT 1")
    c.refus("Choukri", "POST", f"/api/import/factures/{id_facture}/lignes",
            dict(base, code_reference=autre, id_ligne_bc=lignes[0]["id_ligne_bc"]), contient="porte la reference")
    c.ok("Choukri", "POST", f"/api/import/factures/{id_facture}/lignes", dict(base, id_ligne_bc=lignes[0]["id_ligne_bc"]))
    # Servie en local, une ligne ne se propose plus a la facturation.
    id_bc2, lignes2 = bon_envoye(c, [(ref, 100, 2.0)], frs="FRS-001")
    reception_validee(c, id_bc2, lignes2, [100], lot_fournisseur="LOT-BON-2", nb_bobines=38)
    ouvertes = c.ok("Choukri", "GET", "/api/import/lignes-bc?fournisseur=FRS-001")
    verifier(all(x["id_ligne_bc"] != lignes2[0]["id_ligne_bc"] for x in ouvertes),
             "une ligne de bon deja servie en local reste proposee a l'import")


def scenario_gardes_p1(c, infra):
    """Arbitrages du 09/10 : une date vide est une date absente ; la tolerance du fournisseur se
    fixe au droit VALIDER et se journalise ; le modele de droits n'oublie aucun champ sensible."""
    # Un bon sans date de livraison (regression de la contrainte de format du 08/10).
    bc = c.ok("Assistante", "POST", "/api/bons-commande", {
        "code_fournisseur": FRS, "date_livraison_prevue": "",
        "lignes": [{"code_reference": REF, "unite_commande": "kg", "quantite_commandee_unite": 100,
                    "prix_unitaire_devise": 20}]})
    verifier(infra.valeur(f"SELECT coalesce(date_livraison_prevue, 'NULL') FROM bon_commande "
                          f"WHERE id_bc = '{bc['id_bc']}'") == "NULL", "la date vide n'est pas devenue NULL")

    # La tolerance de pesee : l'assistante corrige la fiche, pas le seuil.
    tol = infra.valeur(f"SELECT tolerance_pesee_pct FROM fournisseur WHERE code_fournisseur = '{FRS}'")
    c.ok("Assistante", "PATCH", f"/api/fournisseurs/{FRS}", {"telephone": "0539000000", "tolerance_pesee_pct": tol})
    c.refus("Assistante", "PATCH", f"/api/fournisseurs/{FRS}", {"tolerance_pesee_pct": 10}, contient="valider")
    c.ok("Choukri", "PATCH", f"/api/fournisseurs/{FRS}", {"tolerance_pesee_pct": 3})
    verifier(int(infra.valeur("SELECT count(*) FROM audit_log WHERE table_concernee = 'fournisseur' "
                              "AND nouvelles_valeurs LIKE '%tolerance_pesee_pct%'")) >= 1,
             "le changement de tolerance n'est pas au journal")
    c.ok("Choukri", "PATCH", f"/api/fournisseurs/{FRS}", {"tolerance_pesee_pct": tol})
    verifier(controle(infra, "C46") == 0, "un champ sensible n'a pas de ligne dans le modele de droits")
    # Regle 8 : le prix d'une proposition est d'abord le dernier prix d'achat chez ce fournisseur.
    bon_envoye(c, [(REF, 100, 20.0)])
    dernier = infra.valeur(f"SELECT fn_dernier_prix_achat_mad('{REF}', '{FRS}')")
    verifier(dernier is not None and abs(float(dernier) - 20) < 0.001, f"dernier prix d'achat : {dernier} au lieu de 20")
    # Regle 9 : la saison se regle (Direction), les stocks minimums a revoir se listent.
    c.ok("Choukri", "PATCH", "/api/saisons/1", {"coefficient": 0.7})
    verifier(abs(float(infra.valeur("SELECT coefficient FROM saison_mois WHERE mois = 1")) - 0.7) < 1e-9,
             "le coefficient de janvier n'est pas enregistre")
    c.refus("Magasinie", "PATCH", "/api/saisons/1", {"coefficient": 2})
    c.refus("Choukri", "PATCH", "/api/saisons/1", {"coefficient": 0})
    c.ok("Choukri", "PATCH", "/api/saisons/1", {"coefficient": 1})
    c.ok("Assistante", "GET", "/api/plan-achat/stocks-minimums")
    verifier(int(infra.valeur("SELECT count(*) FROM v_controles WHERE code IN ('C49', 'C50')")) == 2,
             "les controles C49 et C50 manquent")
    # La supervision complete (2026-09-20d, rejouee par 09b) : plus d'« erreur interne ».
    sup = c.ok("Choukri", "GET", "/api/supervision")
    verifier(sup, "la supervision ne rend rien")


SCENARIOS = [
    scenario_bon_segregation,
    scenario_reception_cloture_avoir,
    scenario_ecart_pesee,
    scenario_reception_devalidee_revalidee,
    scenario_saisie_libre,
    scenario_stock_jamais_negatif,
    scenario_contre_passation,
    scenario_inventaire,
    scenario_colisage_signale,
    scenario_colisage_ecran_et_base,
    scenario_import,
    scenario_import_coherence,
    scenario_lots_autorisations,
    scenario_machine,
    scenario_machine_surplus,
    scenario_declencheurs,
    scenario_audit_montants,
    scenario_masquage,
    scenario_sessions,
    scenario_concurrence_numerotation,
    scenario_gardes_p1,
    scenario_sortie_hors_machine,
    scenario_controle_reception,
    scenario_retour_cloture_avoirs,
    scenario_taux_bon,
    scenario_plan_detail,
    scenario_derogation_bornee,
    scenario_machine_constat,
    scenario_lots_vivants,
    scenario_import_bon_envoye,
    scenario_controles_finaux,
]
