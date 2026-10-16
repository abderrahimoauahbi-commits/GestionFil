"""Génère frontend/src/styles/chartes.css : les cinq styles de Gestion Fil.

Les jetons sont donnés en HEX ici (lisibles) et écrits en triplets HSL, la forme
qu'attend `@theme inline` (`hsl(var(--x))`). Un quatrième terme « / alpha » rend
une surface translucide : c'est ainsi que les chartes de verre rendent TOUT
translucide, tableaux compris, sans toucher aux écrans.
"""
import colorsys
import os

SORTIE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "styles", "chartes.css")


def hsl(v):
    alpha = None
    if "/" in v:
        v, alpha = (x.strip() for x in v.split("/"))
    r, g, b = (int(v[i:i + 2], 16) / 255 for i in (1, 3, 5))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    t = f"{round(h * 360)} {round(s * 100, 1):g}% {round(l * 100, 1):g}%"
    return f"{t} / {alpha}" if alpha else t


def jetons(d):
    return "\n".join(f"  --{k}: {hsl(v)};" for k, v in d.items())


CLAIR_DEGRADES = {
    "fond": "#F8FAFF", "texte": "#0F172A", "surface": "#FFFFFF", "surface-texte": "#0F172A",
    "attenue": "#F1F4FB", "attenue-texte": "#64748B", "accent": "#1E3A8A", "accent-texte": "#FFFFFF",
    "primaire": "#4338CA", "primaire-texte": "#FFFFFF", "or": "#A07A2C",
    "danger": "#B91C1C", "danger-texte": "#FFFFFF", "succes": "#15803D", "alerte": "#B45309", "info": "#2563EB",
    "bordure": "#E5E7EB", "ligne": "#EEF0F6", "champ": "#A5ADBD", "anneau": "#4F46E5",
    "barre": "#EEF2FF", "barre-texte": "#0F172A", "barre-attenue": "#64748B", "barre-actif": "#E0E7FF",
}
SOMBRE_DEGRADES = {
    "fond": "#0B0D14", "texte": "#E8EAF0", "surface": "#14171F", "surface-texte": "#E8EAF0",
    "attenue": "#1A1E2E", "attenue-texte": "#8A90A0", "accent": "#8B95E8", "accent-texte": "#0B0D14",
    "primaire": "#8B95E8", "primaire-texte": "#0B0D14", "or": "#D3B06A",
    "danger": "#F87171", "danger-texte": "#14060A", "succes": "#4ADE80", "alerte": "#FBBF24", "info": "#7AA2FF",
    "bordure": "#232838", "ligne": "#1C2030", "champ": "#3A4058", "anneau": "#8B95E8",
    "barre": "#101320", "barre-texte": "#E8EAF0", "barre-attenue": "#8A90A0", "barre-actif": "#1A1E30",
}
CLAIR_SOBRE = {
    "fond": "#FBFBFD", "texte": "#111827", "surface": "#FFFFFF", "surface-texte": "#111827",
    "attenue": "#F7F8FA", "attenue-texte": "#6B7280", "accent": "#1E3A8A", "accent-texte": "#FFFFFF",
    "primaire": "#1E3A8A", "primaire-texte": "#FFFFFF", "or": "#A07A2C",
    "danger": "#DC2626", "danger-texte": "#FFFFFF", "succes": "#16A34A", "alerte": "#B45309", "info": "#2563EB",
    "bordure": "#E5E7EB", "ligne": "#EEF0F3", "champ": "#A3AAB7", "anneau": "#1E3A8A",
    "barre": "#F3F5F8", "barre-texte": "#111827", "barre-attenue": "#6B7280", "barre-actif": "#FFFFFF",
}
GRAPHITE = {
    "fond": "#15171C", "texte": "#ECEEF2", "surface": "#16191F / 0.62", "surface-texte": "#ECEEF2",
    "attenue": "#FFFFFF / 0.05", "attenue-texte": "#9AA2B1", "accent": "#C4A15A", "accent-texte": "#1A1712",
    "primaire": "#C9A75F", "primaire-texte": "#1A1712", "or": "#C4A15A",
    "danger": "#FF8E8E", "danger-texte": "#1A0A0A", "succes": "#7EDCA4", "alerte": "#F2C46B", "info": "#9DB7FF",
    "bordure": "#FFFFFF / 0.10", "ligne": "#FFFFFF / 0.07", "champ": "#FFFFFF / 0.18", "anneau": "#C4A15A",
    "barre": "#16191F / 0.46", "barre-texte": "#ECEEF2", "barre-attenue": "#9AA2B1", "barre-actif": "#C4A15A / 0.14",
}


def R(charte, sombre=None):
    """Sélecteur d'une charte. `sombre` : True = seulement en sombre, False = seulement en clair."""
    base = f":root[data-charte='{charte}']"
    if sombre is True:
        return base + ".sombre"
    if sombre is False:
        return base + ":not(.sombre)"
    return base


ENTETE = """/* =============================================================================
   LES CINQ STYLES DE GESTION FIL — 05/10/2026
   -----------------------------------------------------------------------------
   Fichier GÉNÉRÉ par frontend/outils/fabriquer-chartes.py, ne pas l'éditer à
   la main : les jetons y sont écrits en HEX. Choix du style : Apparence › Style
   (attribut `data-charte` sur <html>).

   Les écrans ne connaissent aucune charte : ils posent des accroches que
   chaque style habille —
     .coquille .barre-laterale .marque-nav .titre-nav .lien-nav(.actif)
     .barre-haut .entete-page .carte .carte-stat[data-ton] (.filet-stat,
     .pastille-stat) .cadre-table table.grille .bouton[data-variante]
     .etiquette[data-ton] .champ-saisie .onglets-liste .onglet
   Ces règles sont HORS couche : elles l'emportent sur les utilitaires
   Tailwind (rangés dans @layer utilities), sans `!important`.
   ========================================================================== */

/* --- Socle commun : Inter, dense, en-têtes de tableau en petites capitales --- */
:root[data-charte]:not([data-charte='classique'], [data-charte='laiton'], [data-charte='industriel'], [data-charte='atlas'], [data-charte='nordique'], [data-charte='terminal'], [data-charte='ardoise'], [data-charte='graphite'], [data-charte='slate'], [data-charte='divalto'], [data-charte='chaud'], [data-charte='contraste'], [data-charte='claude'], [data-charte='azur']) body {
  font-family: "Inter Variable", "Inter", "Segoe UI", system-ui, sans-serif;
  font-feature-settings: "cv11";
}
:root[data-charte]:not([data-charte='classique'], [data-charte='laiton'], [data-charte='industriel'], [data-charte='atlas'], [data-charte='nordique'], [data-charte='terminal'], [data-charte='ardoise'], [data-charte='graphite'], [data-charte='slate'], [data-charte='divalto'], [data-charte='chaud'], [data-charte='contraste'], [data-charte='claude'], [data-charte='azur']) .coquille {
  background: transparent;
}
:root[data-charte]:not([data-charte='classique'], [data-charte='laiton'], [data-charte='industriel'], [data-charte='atlas'], [data-charte='nordique'], [data-charte='terminal'], [data-charte='ardoise'], [data-charte='graphite'], [data-charte='slate'], [data-charte='divalto'], [data-charte='chaud'], [data-charte='contraste'], [data-charte='claude'], [data-charte='azur']) table.grille th {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
:root[data-charte]:not([data-charte='classique'], [data-charte='laiton'], [data-charte='industriel'], [data-charte='atlas'], [data-charte='nordique'], [data-charte='terminal'], [data-charte='ardoise'], [data-charte='graphite'], [data-charte='slate'], [data-charte='divalto'], [data-charte='chaud'], [data-charte='contraste'], [data-charte='claude'], [data-charte='azur']) .entete-page h1 {
  font-size: 1.15em;
  font-weight: 600;
}
:root[data-charte]:not([data-charte='classique'], [data-charte='laiton'], [data-charte='industriel'], [data-charte='atlas'], [data-charte='nordique'], [data-charte='terminal'], [data-charte='ardoise'], [data-charte='graphite'], [data-charte='slate'], [data-charte='divalto'], [data-charte='chaud'], [data-charte='contraste'], [data-charte='claude'], [data-charte='azur']) .etiquette {
  border-radius: 999px;
  font-weight: 600;
}
:root[data-charte]:not([data-charte='classique'], [data-charte='laiton'], [data-charte='industriel'], [data-charte='atlas'], [data-charte='nordique'], [data-charte='terminal'], [data-charte='ardoise'], [data-charte='graphite'], [data-charte='slate'], [data-charte='divalto'], [data-charte='chaud'], [data-charte='contraste'], [data-charte='claude'], [data-charte='azur']) .carte-stat .valeur-arrive {
  font-size: 22px;
}
"""



FAMILLES_CLASSIQUES = ":root:is([data-charte='classique'], [data-charte='laiton'], [data-charte='industriel'], [data-charte='atlas'], [data-charte='nordique'], [data-charte='terminal'], [data-charte='ardoise'], [data-charte='graphite'], [data-charte='slate'], [data-charte='divalto'], [data-charte='chaud'], [data-charte='contraste'], [data-charte='claude'], [data-charte='azur'])"


def bloc_classique():
    a = FAMILLES_CLASSIQUES
    ac = R("classique")
    return f"""
/* =============================================================================
   0. CLASSIQUE — le style d'origine de Gestion Fil (rendu le 06/10/2026)
   -----------------------------------------------------------------------------
   Les jetons de base d'index.css (gris clair, encre, pétrole, or ancien) et
   leur version sombre, la police Source Sans 3, les titres de carte en petites
   capitales, les onglets en pastilles, l'action principale à l'encre, l'écran
   actif du menu en or ancien.
   ========================================================================== */
{ac}:not(.sombre) {{
  /* Moins clair que la base : un gris moyen sous des surfaces claires, pour
     que les cartes et les tableaux se détachent sans éblouir. */
  --fond: 220 12% 84%;
  --attenue: 220 12% 90%;
  --ligne: 220 10% 86%;
  --bordure: 220 10% 78%;
}}
{a} .coquille {{ background: hsl(var(--fond)); }}
{a} .carte-titre {{
  font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
  color: hsl(var(--attenue-texte));
}}
{a} .carte-entete {{ background: hsl(var(--attenue) / 0.6); min-height: 2.5rem; }}
{a} .onglets-liste {{
  width: fit-content; height: auto; gap: 4px; padding: 4px; border: 0;
  border-radius: 8px; background: hsl(var(--attenue));
}}
{a} .onglet {{
  height: auto; margin: 0; padding: 4px 12px; border: 0; border-radius: 6px;
  font-size: 13px; color: hsl(var(--attenue-texte));
}}
{a} .onglet[data-state='active'], {a} .onglet[aria-current='page'] {{
  background: hsl(var(--surface)); color: hsl(var(--texte));
  box-shadow: 0 1px 2px hsl(222 20% 15% / 0.08);
}}
{a} .bouton[data-variante='principal'] {{ background: hsl(var(--accent)); color: hsl(var(--accent-texte)); }}
{a} .lien-nav.actif {{ color: hsl(var(--or)); }}
{a} .lien-nav.actif::before {{ background: hsl(var(--or)); }}
{a} .lien-nav.actif svg {{ color: hsl(var(--or)); }}
"""

def bloc_degrades():
    c, s = R("degrades", False), R("degrades", True)
    a = R("degrades")
    return f"""
/* =============================================================================
   1. CADRES DÉGRADÉS — bleu nuit → indigo, cartes pleines, clair ou sombre
   ========================================================================== */
{a} {{
{jetons(CLAIR_DEGRADES)}
  --radius: 0.4375rem;
  --radius-sm: 0.375rem;
  --radius-lg: 0.75rem;
  --degrade-action: linear-gradient(135deg, #1E3A8A 0%, #4F46E5 100%);
  --degrade-cadre: linear-gradient(135deg, #1E3A8A 0%, #4F46E5 30%, #A5B4FC 70%, #E0E7FF 100%);
  --degrade-entete-table: linear-gradient(180deg, #EEF2FF 0%, #E0E7FF 100%);
  --degrade-menu: linear-gradient(180deg, #F5F7FF 0%, #E9EDFB 40%, #E0E7FF 100%);
  --survol-ligne: rgba(79, 70, 229, 0.07);
  --fond-page:
    radial-gradient(900px 600px at 0% 0%, #E0E7FF 0%, transparent 55%),
    radial-gradient(900px 600px at 100% 0%, #EDE9FE 0%, transparent 55%),
    radial-gradient(1000px 700px at 50% 100%, #DBEAFE 0%, transparent 60%),
    linear-gradient(180deg, #FFFFFF 0%, #F8FAFF 100%);
  color-scheme: light;
}}
{s} {{
{jetons(SOMBRE_DEGRADES)}
  --degrade-action: linear-gradient(135deg, #4F46E5 0%, #7C88E8 100%);
  --degrade-cadre: linear-gradient(135deg, #4F46E5 0%, #7C88E8 40%, #3B3F5C 70%, #1F2233 100%);
  --degrade-entete-table: linear-gradient(180deg, #1A1E2E 0%, #14172A 100%);
  --degrade-menu: linear-gradient(180deg, #101320 0%, #151827 40%, #1A1E30 100%);
  --survol-ligne: rgba(124, 136, 232, 0.10);
  --fond-page:
    radial-gradient(900px 600px at 0% 0%, rgba(79, 70, 229, 0.15) 0%, transparent 55%),
    radial-gradient(900px 600px at 100% 0%, rgba(124, 58, 237, 0.12) 0%, transparent 55%),
    radial-gradient(1000px 700px at 50% 100%, rgba(30, 58, 138, 0.15) 0%, transparent 60%),
    linear-gradient(180deg, #0B0D14 0%, #0F1119 100%);
  color-scheme: dark;
}}
{regles_degrades("degrades")}
/* Le sombre adoucit les pastilles : un pastel sur fond noir brûle les yeux. */
{s} .etiquette[data-ton] {{
  background: color-mix(in srgb, currentColor 15%, transparent);
  box-shadow: none;
}}
{s} .etiquette[data-ton='succes'] {{ color: #4ADE80; }}
{s} .etiquette[data-ton='alerte'] {{ color: #FBBF24; }}
{s} .etiquette[data-ton='danger'] {{ color: #F87171; }}
{s} .etiquette[data-ton='info'] {{ color: #93B4FF; }}
{s} .etiquette[data-ton='neutre'],
{s} .etiquette[data-ton='contour'] {{ color: #A3AAB9; }}
{s} .etiquette[data-ton='or'] {{ color: #E2C27E; }}
{s} .marque-nav > span:last-child > span:first-child {{
  background: linear-gradient(135deg, #8B95E8, #C4B5FD);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}}
{s} .entete-page h1 {{
  background: linear-gradient(135deg, #E8EAF0, #8B95E8);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}}
{s} .bouton[data-variante='contour'] {{
  background: linear-gradient(180deg, #14171F, #101320);
  color: #C7CCF5;
}}
"""


def regles_degrades(nom, pousse=False):
    a = R(nom)
    k = f"{a}:not([data-cadres='simples']):not([data-verre='perso'])"
    regles = f"""
{a} body {{
  background: var(--fond-page);
  background-attachment: fixed;
  background-color: hsl(var(--fond));
}}
/* Le menu : un dégradé vertical, l'écran actif en pastille dégradée lumineuse. */
{a} .barre-laterale {{
  background: var(--degrade-menu);
  border-right: 1px solid rgba(30, 58, 138, 0.08);
}}
{a} .marque-nav > span:last-child > span:first-child {{
  background: linear-gradient(135deg, #1E3A8A 0%, #4F46E5 60%, #7C3AED 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  font-weight: 600;
}}
{a} .titre-nav {{ color: hsl(var(--barre-attenue)); }}
{a} .lien-nav {{ border-radius: 7px; }}
{a} .lien-nav:hover {{ background: rgba(255, 255, 255, 0.55); }}
{a} .lien-nav.actif {{
  color: #FFFFFF;
  background: var(--degrade-action);
  box-shadow: 0 4px 12px rgba(79, 70, 229, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.25);
}}
{a} .lien-nav.actif::before {{ content: none; }}
{a} .lien-nav.actif svg {{ color: #FFFFFF; opacity: 1; }}
{a} .barre-haut {{
  background: color-mix(in srgb, hsl(var(--surface)) 72%, transparent);
  backdrop-filter: blur(12px) saturate(1.3);
}}
{a} .entete-page {{
  background: color-mix(in srgb, hsl(var(--fond)) 78%, transparent);
  backdrop-filter: blur(12px);
}}
{a} .entete-page h1 {{
  background: linear-gradient(135deg, #0F172A, #1E3A8A);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}}
/* Les boutons : l'action en dégradé avec une ombre colorée, le reste en verre clair. */
{a} .bouton[data-variante='principal'],
{a} .bouton[data-variante='primaire'] {{
  background: var(--degrade-action);
  color: #FFFFFF;
  border: 0;
  box-shadow: 0 2px 6px rgba(79, 70, 229, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.25);
}}
{a} .bouton[data-variante='principal']:hover,
{a} .bouton[data-variante='primaire']:hover {{
  filter: brightness(1.08);
  box-shadow: 0 6px 16px rgba(79, 70, 229, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.25);
}}
{a} .bouton[data-variante='danger'] {{
  background: linear-gradient(135deg, #B91C1C 0%, #EF4444 100%);
  color: #FFFFFF;
  box-shadow: 0 2px 6px rgba(220, 38, 38, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.25);
}}
{a} .bouton[data-variante='contour'] {{
  background: linear-gradient(180deg, hsl(var(--surface)), hsl(var(--barre)));
  color: hsl(var(--accent));
  border-color: rgba(79, 70, 229, 0.18);
}}
{a} .bouton[data-variante='contour']:hover {{ border-color: rgba(79, 70, 229, 0.4); }}
/* Les chiffres clés : des cartes PLEINES en dégradé, avec un halo de lumière. */
{k} .carte-stat {{
  border: 0;
  color: #FFFFFF;
  background: linear-gradient(135deg, #1E3A8A 0%, #4F46E5 100%);
  box-shadow: 0 4px 14px rgba(30, 58, 138, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.2);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}}
{k} .carte-stat[data-ton='alerte'] {{ background: linear-gradient(135deg, #B45309 0%, #F59E0B 100%); }}
{k} .carte-stat[data-ton='succes'] {{ background: linear-gradient(135deg, #15803D 0%, #22C55E 100%); }}
{k} .carte-stat[data-ton='danger'],
{k} .carte-stat[data-ton='grave'] {{ background: linear-gradient(135deg, #B91C1C 0%, #F87171 100%); }}
{k} .carte-stat[data-ton='neutre'] {{ background: linear-gradient(135deg, #334155 0%, #64748B 100%); }}
{k} .carte-stat::after {{
  content: ""; position: absolute; right: -30px; top: -30px; width: 110px; height: 110px;
  border-radius: 50%; pointer-events: none;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.22) 0%, transparent 70%);
}}
{k} .carte-stat * {{ color: #FFFFFF; }}
{k} .carte-stat .pastille-stat {{ background: rgba(255, 255, 255, 0.18); }}
{k} .carte-stat .filet-stat {{ display: none; }}
{k} .carte-stat > span:last-child {{ opacity: 0.88; }}
{k} .carte-stat:hover {{ transform: translateY(-2px); }}
/* Le tableau dans un cadre dégradé d'un pixel et demi. */
{a} .cadre-table {{
  border: 1.5px solid transparent;
  border-radius: 12px;
  background:
    linear-gradient(hsl(var(--surface)), hsl(var(--surface))) padding-box,
    var(--degrade-cadre) border-box;
  box-shadow: 0 6px 20px rgba(30, 58, 138, 0.12);
}}
{a} table.grille th {{
  background: var(--degrade-entete-table);
  color: hsl(var(--attenue-texte));
}}
{a} table.grille tbody tr:hover > td {{ background-color: var(--survol-ligne); }}
/* Les statuts : pilules pastel en dégradé, un reflet en haut. */
{a} .etiquette[data-ton] {{
  border: 0;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
}}
{a} .etiquette[data-ton='succes'] {{ background: linear-gradient(135deg, #DCFCE7, #BBF7D0); color: #15803D; }}
{a} .etiquette[data-ton='alerte'] {{ background: linear-gradient(135deg, #FEF3C7, #FDE68A); color: #92400E; }}
{a} .etiquette[data-ton='danger'] {{ background: linear-gradient(135deg, #FEE2E2, #FECACA); color: #B91C1C; }}
{a} .etiquette[data-ton='info'] {{ background: linear-gradient(135deg, #DBEAFE, #BFDBFE); color: #1D4ED8; }}
{a} .etiquette[data-ton='neutre'],
{a} .etiquette[data-ton='contour'] {{ background: linear-gradient(135deg, #F1F5F9, #E2E8F0); color: #475569; }}
{a} .etiquette[data-ton='or'] {{ background: linear-gradient(135deg, #FEF3C7, #F5E3B5); color: #8A6D2E; }}
{a} .etiquette[data-ton='accent'] {{ background: var(--degrade-action); color: #FFFFFF; }}
{a} .carte {{
  border-radius: var(--radius-lg);
  box-shadow: 0 6px 20px rgba(30, 58, 138, 0.08);
}}
{a} .onglet[data-state='active'], {a} .onglet[aria-current='page'] {{ border-color: #4F46E5; color: hsl(var(--texte)); }}
{a} .champ-saisie:focus-visible {{
  border-color: #4F46E5;
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.18);
}}
"""
    if pousse:
        regles += f"""
/* --- Poussé plus loin : tout en dégradés, relief au survol --- */
{a} .bouton[data-variante='contour'] {{
  background: linear-gradient(180deg, #FFFFFF 0%, #F1F4FB 100%);
  border-color: rgba(30, 58, 138, 0.15);
  box-shadow: 0 1px 2px rgba(30, 58, 138, 0.06);
}}
{a} .bouton[data-variante='contour']:hover {{
  box-shadow: 0 4px 10px rgba(79, 70, 229, 0.15);
  transform: translateY(-1px);
}}
{a} .bouton[data-variante='principal']:hover,
{a} .bouton[data-variante='primaire']:hover {{ transform: translateY(-1px); }}
{a} .carte,
{a} .cadre-table {{
  background:
    linear-gradient(180deg, #FFFFFF 0%, #FAFBFF 100%) padding-box,
    var(--degrade-cadre) border-box;
}}
{a} .carte {{ border: 1px solid rgba(79, 70, 229, 0.14); }}
{a} table.grille tbody tr:nth-child(odd) > td {{
  background-image: linear-gradient(90deg, rgba(238, 242, 255, 0.55), rgba(255, 255, 255, 0));
}}
{a} table.grille tbody tr:hover > td {{
  background-image: linear-gradient(90deg, rgba(79, 70, 229, 0.08) 0%, rgba(165, 180, 252, 0.04) 50%, transparent 100%);
}}
{a} .etiquette[data-ton] {{
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6), 0 1px 2px rgba(0, 0, 0, 0.05);
}}
{a} .carte-stat:hover {{
  box-shadow: 0 10px 24px rgba(30, 58, 138, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.2);
}}
"""
    return regles


def bloc_full():
    a = R("full-degrades")
    return f"""
/* =============================================================================
   2. TOUT EN DÉGRADÉS — la même famille poussée plus loin, en clair
   ========================================================================== */
{a}, {a}.sombre {{
{jetons(CLAIR_DEGRADES)}
  --radius: 0.4375rem;
  --radius-sm: 0.375rem;
  --radius-lg: 0.75rem;
  --degrade-action: linear-gradient(135deg, #1E3A8A 0%, #4F46E5 100%);
  --degrade-cadre: linear-gradient(135deg, #1E3A8A 0%, #4F46E5 30%, #A5B4FC 70%, #E0E7FF 100%);
  --degrade-entete-table: linear-gradient(180deg, #EEF2FF 0%, #E0E7FF 100%);
  --degrade-menu: linear-gradient(180deg, #F5F7FF 0%, #E9EDFB 40%, #E0E7FF 100%);
  --survol-ligne: rgba(79, 70, 229, 0.07);
  --fond-page:
    radial-gradient(900px 600px at 0% 0%, #E0E7FF 0%, transparent 55%),
    radial-gradient(900px 600px at 100% 0%, #EDE9FE 0%, transparent 55%),
    radial-gradient(1000px 700px at 50% 100%, #DBEAFE 0%, transparent 60%),
    linear-gradient(180deg, #FFFFFF 0%, #F8FAFF 100%);
  --ombre-levee: 0 1px 2px hsl(222 40% 30% / 0.08);
  --ombre-flottante: 0 2px 6px -2px hsl(222 40% 30% / 0.14), 0 10px 24px -8px hsl(222 40% 30% / 0.18);
  --ombre-modale: 0 4px 10px -4px hsl(222 40% 30% / 0.18), 0 22px 48px -12px hsl(222 40% 30% / 0.26);
  color-scheme: light;
}}
{regles_degrades("full-degrades", pousse=True)}"""


def bloc_sobre():
    a = R("sobre")
    return f"""
/* =============================================================================
   3. CADRES DÉGRADÉS — SOBRE : la couleur en filets, pas en aplats
   ========================================================================== */
{a}, {a}.sombre {{
{jetons(CLAIR_SOBRE)}
  --radius: 0.375rem;
  --radius-sm: 0.3125rem;
  --radius-lg: 0.625rem;
  --ombre-levee: 0 1px 2px hsl(222 40% 30% / 0.06);
  --ombre-flottante: 0 2px 6px -2px hsl(222 40% 30% / 0.12), 0 10px 24px -8px hsl(222 40% 30% / 0.16);
  --ombre-modale: 0 4px 10px -4px hsl(222 40% 30% / 0.16), 0 22px 48px -12px hsl(222 40% 30% / 0.22);
  color-scheme: light;
}}
{a} body {{
  background:
    radial-gradient(1200px 400px at 0% 0%, #EEF2FF 0%, transparent 60%),
    radial-gradient(900px 400px at 100% 100%, #F5F3FF 0%, transparent 55%),
    #FFFFFF;
  background-attachment: fixed;
}}
{a} .barre-laterale {{
  background: linear-gradient(180deg, #F7F8FA 0%, #EEF1F6 100%);
  border-right: 1px solid hsl(var(--bordure));
}}
{a} .marque-nav > span:last-child > span:first-child {{
  background: linear-gradient(90deg, #1E3A8A, #4F46E5);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}}
{a} .titre-nav {{ color: hsl(var(--barre-attenue)); }}
/* L'écran actif : une petite carte blanche bordée, pas un aplat de couleur. */
{a} .lien-nav.actif {{
  background: linear-gradient(180deg, #FFFFFF, #F1F4FB);
  color: hsl(var(--texte));
  box-shadow: 0 0 0 1px hsl(var(--bordure)), 0 1px 2px rgba(30, 58, 138, 0.06);
}}
{a} .lien-nav.actif::before {{ content: none; }}
{a} .lien-nav.actif svg {{ color: #1E3A8A; }}
{a} .lien-nav:hover {{ background: rgba(255, 255, 255, 0.6); }}
{a} .barre-haut {{
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(10px);
}}
{a} .entete-page {{
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(10px);
}}
{a} .bouton[data-variante='principal'],
{a} .bouton[data-variante='primaire'] {{
  background: linear-gradient(180deg, #2A4CA8 0%, #1E3A8A 100%);
  color: #FFFFFF;
  border: 0;
  box-shadow: 0 1px 2px rgba(30, 58, 138, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.18);
}}
{a} .bouton[data-variante='principal']:hover,
{a} .bouton[data-variante='primaire']:hover {{
  filter: brightness(1.05);
  box-shadow: 0 3px 10px rgba(30, 58, 138, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.18);
}}
{a} .bouton[data-variante='contour'] {{
  background: linear-gradient(180deg, #FFFFFF, #F7F8FA);
  color: #1E3A8A;
}}
{a} .bouton[data-variante='contour']:hover {{
  border-color: rgba(30, 58, 138, 0.35);
  box-shadow: 0 2px 6px rgba(30, 58, 138, 0.08);
}}
/* Les chiffres clés : blancs, un filet dégradé de trois pixels à gauche. */
{a} .carte-stat {{
  background: linear-gradient(180deg, #FFFFFF 0%, #FAFBFF 100%);
  border-radius: 8px;
  transition: box-shadow 0.2s ease, transform 0.15s ease;
}}
{a} .carte-stat .filet-stat {{
  display: block;
  inset: 0 auto 0 0;
  width: 3px; height: auto;
  border-radius: 8px 0 0 8px;
  background: linear-gradient(180deg, #1E3A8A, #4F46E5);
}}
{a} .carte-stat[data-ton='alerte'] .filet-stat {{ background: linear-gradient(180deg, #D97706, #F59E0B); }}
{a} .carte-stat[data-ton='succes'] .filet-stat {{ background: linear-gradient(180deg, #16A34A, #22C55E); }}
{a} .carte-stat[data-ton='danger'] .filet-stat,
{a} .carte-stat[data-ton='grave'] .filet-stat {{ background: linear-gradient(180deg, #DC2626, #F87171); }}
{a} .carte-stat:hover {{ box-shadow: 0 4px 14px rgba(30, 58, 138, 0.1); transform: translateY(-1px); }}
{a} .cadre-table {{
  border: 1px solid transparent;
  border-radius: 10px;
  background:
    linear-gradient(#FFFFFF, #FFFFFF) padding-box,
    linear-gradient(135deg, rgba(30, 58, 138, 0.18) 0%, rgba(79, 70, 229, 0.08) 40%, #E5E7EB 100%) border-box;
  box-shadow: 0 1px 3px rgba(30, 58, 138, 0.06);
}}
{a} table.grille th {{
  background: linear-gradient(180deg, #F7F8FA, #EEF1F6);
  color: hsl(var(--attenue-texte));
  font-weight: 500;
}}
{a} table.grille tbody tr:hover > td {{
  background-image: linear-gradient(90deg, rgba(30, 58, 138, 0.04), transparent 60%);
}}
/* Les statuts : de petites étiquettes rectangulaires, aplat pastel. */
{a} .etiquette[data-ton] {{ border: 0; border-radius: 3px; font-weight: 500; }}
{a} .etiquette[data-ton='succes'] {{ background: #DCFCE7; color: #15803D; }}
{a} .etiquette[data-ton='alerte'] {{ background: #FEF3C7; color: #B45309; }}
{a} .etiquette[data-ton='danger'] {{ background: #FEE2E2; color: #DC2626; }}
{a} .etiquette[data-ton='info'] {{ background: #DBEAFE; color: #1D4ED8; }}
{a} .etiquette[data-ton='neutre'],
{a} .etiquette[data-ton='contour'] {{ background: #F3F4F6; color: #4B5563; }}
{a} .etiquette[data-ton='or'] {{ background: #FBF3DF; color: #8A6D2E; }}
{a} .etiquette[data-ton='accent'] {{ background: #1E3A8A; color: #FFFFFF; }}
{a} .carte {{ border-radius: var(--radius-lg); box-shadow: 0 1px 3px rgba(30, 58, 138, 0.05); }}
{a} .onglet[data-state='active'], {a} .onglet[aria-current='page'] {{ border-color: #1E3A8A; }}
{a} .champ-saisie:focus-visible {{ border-color: #1E3A8A; box-shadow: 0 0 0 3px rgba(30, 58, 138, 0.14); }}
"""


def bloc_graphite():
    a = R("graphite-verre")
    verre = "backdrop-filter: blur(16px) saturate(1.3);"
    return f"""
/* =============================================================================
   4. GRAPHITE, VERRE ET OR ANCIEN — tout translucide sur les fils dorés
   ========================================================================== */
{a}, {a}.sombre {{
{jetons(GRAPHITE)}
  --radius: 0.4375rem;
  --radius-sm: 0.375rem;
  --radius-lg: 0.625rem;
  --filet-or: rgba(196, 161, 90, 0.38);
  --ombre-levee: 0 8px 24px rgba(0, 0, 0, 0.25);
  --ombre-flottante: 0 2px 6px -2px rgba(0, 0, 0, 0.5), 0 14px 30px -8px rgba(0, 0, 0, 0.6);
  --ombre-modale: 0 4px 10px -4px rgba(0, 0, 0, 0.55), 0 24px 56px -12px rgba(0, 0, 0, 0.7);
  color-scheme: dark;
}}
{a} body {{
  background:
    linear-gradient(180deg, rgba(10, 12, 16, 0.35), rgba(10, 12, 16, 0.55)),
    url("/fond-fils-graphite.jpg") center / cover fixed,
    #15171C;
}}
/* Tout ce qui est posé sur la page est du verre : on voit les fils au travers. */
{a} .barre-laterale,
{a} .barre-haut,
{a} .entete-page,
{a} .carte,
{a} .carte-stat,
{a} .cadre-table {{ {verre} }}
{a} .barre-laterale {{ border-right: 1px solid var(--filet-or); }}
{a} .marque-nav {{ border-bottom: 1px solid var(--filet-or); }}
{a} .titre-nav {{ color: #6F7787; }}
{a} .lien-nav.actif {{
  color: #DCC08A;
  background: linear-gradient(90deg, rgba(196, 161, 90, 0.16), rgba(196, 161, 90, 0.03));
  box-shadow: inset 0 0 0 1px rgba(196, 161, 90, 0.22);
}}
{a} .lien-nav.actif::before {{ background: #C4A15A; }}
{a} .lien-nav.actif svg {{ color: #C4A15A; }}
{a} .barre-haut {{ background: rgba(18, 20, 26, 0.55); border-bottom-color: var(--filet-or); }}
{a} .entete-page {{ background: rgba(18, 20, 26, 0.40); border-bottom-color: rgba(255, 255, 255, 0.08); }}
{a} .bouton[data-variante='principal'],
{a} .bouton[data-variante='primaire'] {{
  background: linear-gradient(180deg, #D4B26B 0%, #B8954D 100%);
  color: #1A1712;
  border: 0;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(196, 161, 90, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.35);
}}
{a} .bouton[data-variante='principal']:hover,
{a} .bouton[data-variante='primaire']:hover {{
  filter: brightness(1.06);
  box-shadow: 0 6px 16px rgba(196, 161, 90, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.35);
}}
{a} .bouton[data-variante='contour'] {{
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.14);
  color: hsl(var(--texte));
}}
{a} .bouton[data-variante='contour']:hover {{ border-color: var(--filet-or); background: rgba(255, 255, 255, 0.09); }}
{a} .bouton[data-variante='danger'] {{ background: rgba(255, 142, 142, 0.16); color: #FFB3B3; border: 1px solid rgba(255, 142, 142, 0.35); }}
{a} .carte-stat {{
  background: rgba(22, 25, 32, 0.46);
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.06);
}}
{a} .carte-stat .filet-stat {{
  inset: 0 14px auto 14px; height: 1px;
  background: linear-gradient(90deg, transparent, #C4A15A, transparent);
}}
{a} .carte-stat[data-ton='primaire'] .valeur-arrive {{ color: #DCC08A; }}
{a} .cadre-table {{
  background: rgba(18, 20, 27, 0.62);
  border-color: rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.05);
}}
{a} table.grille th {{
  color: #DCC08A;
  font-weight: 500;
  letter-spacing: 0.07em;
  background: rgba(26, 29, 36, 0.92);
  border-bottom: 1px solid var(--filet-or);
}}
{a} table.grille td {{ background-color: transparent; }}
{a} table.grille tbody tr:hover > td {{
  background-image: linear-gradient(90deg, rgba(196, 161, 90, 0.10), rgba(196, 161, 90, 0) 70%);
}}
{a} .etiquette[data-ton] {{
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
  background: color-mix(in srgb, currentColor 11%, transparent);
}}
{a} .etiquette[data-ton='succes'] {{ color: #7EDCA4; }}
{a} .etiquette[data-ton='alerte'] {{ color: #F2C46B; }}
{a} .etiquette[data-ton='danger'] {{ color: #FF8E8E; }}
{a} .etiquette[data-ton='info'] {{ color: #9DB7FF; }}
{a} .etiquette[data-ton='neutre'],
{a} .etiquette[data-ton='contour'] {{ color: #A9B0BC; }}
{a} .etiquette[data-ton='or'],
{a} .etiquette[data-ton='accent'] {{ color: #DCC08A; }}
{a} .carte {{
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.05);
}}
{a} .onglet[data-state='active'], {a} .onglet[aria-current='page'] {{ border-color: #C4A15A; color: #DCC08A; }}
{a} .champ-saisie {{ background: rgba(0, 0, 0, 0.22); }}
{a} .champ-saisie:focus-visible {{ border-color: #C4A15A; box-shadow: 0 0 0 3px rgba(196, 161, 90, 0.18); }}
/* Les surcouches (menus, dialogues) : un verre plus dense, lisible sur tout fond. */
{a} [role='dialog'],
{a} [role='menu'],
{a} [role='listbox'] {{
  background-color: rgba(24, 27, 34, 0.9);
  {verre}
}}
"""


LIQUIDE_SOMBRE = {
    "fond": "#04050A", "texte": "#DCEBFF", "surface": "#0A0E19 / 0.72", "surface-texte": "#DCEBFF",
    "attenue": "#000000 / 0.30", "attenue-texte": "#8EA2C4", "accent": "#38BDF8", "accent-texte": "#04050A",
    "primaire": "#38BDF8", "primaire-texte": "#04050A", "or": "#D3B06A",
    "danger": "#F87171", "danger-texte": "#14060A", "succes": "#5EEAD4", "alerte": "#FBBF24", "info": "#7DD3FC",
    "bordure": "#8CBEFF / 0.12", "ligne": "#8CBEFF / 0.06", "champ": "#8CBEFF / 0.18", "anneau": "#38BDF8",
    "barre": "#0A0E19 / 0.78", "barre-texte": "#DCEBFF", "barre-attenue": "#8EA2C4", "barre-actif": "#38BDF8 / 0.16",
}
LIQUIDE_CLAIR = {
    "fond": "#F3F6FC", "texte": "#0B1220", "surface": "#FFFFFF / 0.74", "surface-texte": "#0B1220",
    "attenue": "#0F172A / 0.04", "attenue-texte": "#45536E", "accent": "#0891B2", "accent-texte": "#FFFFFF",
    "primaire": "#0284C7", "primaire-texte": "#FFFFFF", "or": "#A07A2C",
    "danger": "#DC2626", "danger-texte": "#FFFFFF", "succes": "#0D9488", "alerte": "#B45309", "info": "#0284C7",
    "bordure": "#1E3A6E / 0.12", "ligne": "#1E3A6E / 0.07", "champ": "#1E3A6E / 0.20", "anneau": "#0891B2",
    "barre": "#FFFFFF / 0.72", "barre-texte": "#0B1220", "barre-attenue": "#5B6B86", "barre-actif": "#0EA5E9 / 0.12",
}


def bloc_liquide():
    a = R("liquid-glass")
    s = R("liquid-glass", True)
    g = '"Space Grotesk Variable", "Space Grotesk", "Inter Variable", sans-serif'
    return f"""
/* =============================================================================
   5. VERRE LIQUIDE — d'après la maquette « verre net » de la direction
   -----------------------------------------------------------------------------
   Fond : ondes de points reliés (public/fond-ondes.jpg et fond-ondes-clair.jpg,
   fabriqués par outils/fabriquer-fond-ondes.py). Verre NET : translucide SANS
   flou, le fond reste net derrière. Polices fines : Inter léger pour le texte,
   Space Grotesk pour titres, libellés, chiffres et boutons ; petites tailles ;
   libellés en capitales très espacées ; statuts en point coloré ; onglets en
   pilule ; boutons à filet cyan. Les MÊMES contrôles en clair et en sombre :
   seules les variables --lq-* changent.
   ========================================================================== */
{a} {{
{jetons(LIQUIDE_CLAIR)}
  --radius: 0.5rem;
  --radius-sm: 0.4375rem;
  --radius-lg: 1rem;
  --lq-verre: rgba(255, 255, 255, 0.74);
  --lq-filet: rgba(30, 58, 110, 0.10);
  --lq-filet-bleu: rgba(30, 58, 110, 0.08);
  --lq-libelle: rgba(30, 50, 90, 0.78);
  --lq-texte: rgba(11, 18, 32, 0.92);
  --lq-fort: #0B1220;
  --lq-creux: rgba(255, 255, 255, 0.78);
  --lq-creux-focus: #FFFFFF;
  --lq-pilule: rgba(30, 58, 110, 0.06);
  --lq-actif: rgba(14, 165, 233, 0.14);
  --lq-actif-texte: #0369A1;
  --lq-cyan: #0891B2;
  --lq-cyan-filet: rgba(8, 145, 178, 0.38);
  --lq-cyan-filet-fort: rgba(8, 145, 178, 0.75);
  --lq-bouton: rgba(255, 255, 255, 0.72);
  --lq-bouton-survol: #FFFFFF;
  --lq-entete: rgba(255, 255, 255, 0.66);
  --lq-th: rgba(244, 247, 253, 0.96);
  --lq-table: rgba(255, 255, 255, 0.93);
  --lq-survol: rgba(14, 165, 233, 0.05);
  --lq-ombre: 0 20px 50px rgba(30, 58, 110, 0.12);
  --lq-surcouche: rgba(255, 255, 255, 0.96);
  --lq-ok: #0D9488; --lq-attente: #B45309; --lq-erreur: #DC2626; --lq-info: #0284C7;
  --lq-neutre: rgba(30, 58, 110, 0.55); --lq-or: #8A6D2E;
  --lq-fond-page:
    radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(220, 228, 245, 0.55) 100%),
    url("/fond-ondes-clair.jpg") center / cover fixed,
    #F3F6FC;
  --ombre-levee: 0 20px 50px rgba(30, 58, 110, 0.12);
  --ombre-flottante: 0 20px 50px rgba(30, 58, 110, 0.18);
  --ombre-modale: 0 30px 70px rgba(30, 58, 110, 0.25);
  color-scheme: light;
}}
{s} {{
{jetons(LIQUIDE_SOMBRE)}
  --lq-verre: rgba(10, 14, 25, 0.72);
  --lq-filet: rgba(255, 255, 255, 0.12);
  --lq-filet-bleu: rgba(140, 190, 255, 0.08);
  --lq-libelle: rgba(180, 210, 255, 0.5);
  --lq-texte: rgba(220, 235, 255, 0.88);
  --lq-fort: #FFFFFF;
  --lq-creux: rgba(0, 0, 0, 0.32);
  --lq-creux-focus: rgba(0, 0, 0, 0.45);
  --lq-pilule: rgba(0, 0, 0, 0.3);
  --lq-actif: rgba(56, 189, 248, 0.18);
  --lq-actif-texte: #FFFFFF;
  --lq-cyan: #22D3EE;
  --lq-cyan-filet: rgba(34, 211, 238, 0.35);
  --lq-cyan-filet-fort: rgba(34, 211, 238, 0.7);
  --lq-bouton: rgba(255, 255, 255, 0.06);
  --lq-bouton-survol: rgba(255, 255, 255, 0.1);
  --lq-entete: rgba(6, 8, 15, 0.62);
  --lq-th: rgba(6, 9, 16, 0.94);
  --lq-table: rgba(7, 10, 18, 0.9);
  --lq-survol: rgba(56, 189, 248, 0.04);
  --lq-ombre: 0 30px 80px rgba(0, 0, 0, 0.55);
  --lq-surcouche: rgba(10, 14, 25, 0.94);
  --lq-ok: #5EEAD4; --lq-attente: #FCD34D; --lq-erreur: #FCA5A5; --lq-info: #7DD3FC;
  --lq-neutre: rgba(180, 210, 255, 0.6); --lq-or: #E2C27E;
  --lq-fond-page:
    radial-gradient(ellipse at 50% 50%, transparent 25%, rgba(0, 0, 0, 0.5) 75%, rgba(0, 0, 0, 0.9) 100%),
    radial-gradient(ellipse at 50% 50%, rgba(4, 5, 10, 0.35) 0%, rgba(4, 5, 10, 0.7) 70%, rgba(4, 5, 10, 0.92) 100%),
    url("/fond-ondes.jpg") center / cover fixed,
    #04050A;
  --ombre-levee: 0 30px 80px rgba(0, 0, 0, 0.55);
  --ombre-flottante: 0 30px 80px rgba(0, 0, 0, 0.6);
  --ombre-modale: 0 30px 80px rgba(0, 0, 0, 0.7);
  color-scheme: dark;
}}

/* --- Page, polices fines, petites tailles ----------------------------------- */
{a} body {{
  font-weight: 300;
  font-size: 12.5px;
  color: var(--lq-texte);
  background: var(--lq-fond-page);
  background-attachment: fixed;
}}
{a} h1, {a} h2, {a} h3, {a} .marque-nav {{ font-family: {g}; font-weight: 500; letter-spacing: 0.01em; }}
{a} .entete-page h1 {{ font-size: 15px; color: var(--lq-fort); }}
{a} .entete-page p {{ font-size: 11px; font-weight: 300; }}
{a} .text-\\[13px\\] {{ font-size: 12px; }}
{a} .text-\\[12\\.5px\\] {{ font-size: 11.5px; }}
{a} .font-semibold {{ font-weight: 500; }}
{a} .font-medium {{ font-weight: 400; }}

/* --- Le verre net ---------------------------------------------------------- */
{a} .barre-laterale,
{a} .carte,
{a} .carte-stat {{
  background: var(--lq-verre);
  border: 1px solid var(--lq-filet);
  box-shadow: var(--lq-ombre);
}}
{a} .carte, {a} .carte-stat {{ border-radius: 16px; }}
{a} .barre-laterale {{ border-width: 0 1px 0 0; box-shadow: none; }}
{a} .barre-haut,
{a} .entete-page {{ background: var(--lq-entete); border-bottom: 1px solid var(--lq-filet); }}

/* --- La marque et le menu --------------------------------------------------- */
{a} .marque-nav > span:first-child {{
  background: linear-gradient(135deg, #22D3EE, #8B5CF6 60%, #EC4899);
  box-shadow: none;
}}
{a} .marque-nav > span:last-child > span:last-child {{
  font-family: "Inter Variable", sans-serif;
  font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.2em; color: var(--lq-libelle);
}}
{a} .titre-nav {{ font-family: {g}; font-size: 8.5px; letter-spacing: 0.24em; color: var(--lq-libelle); }}
{a} .lien-nav {{ font-size: 12px; font-weight: 400; color: var(--lq-libelle); }}
{a} .lien-nav:hover {{ color: var(--lq-fort); background: var(--lq-pilule); }}
{a} .lien-nav.actif {{ color: var(--lq-actif-texte); background: var(--lq-actif); font-weight: 500; }}
{a} .lien-nav.actif::before {{ background: var(--lq-cyan); }}
{a} .lien-nav.actif svg {{ color: var(--lq-cyan); }}

/* --- Onglets en pilule ------------------------------------------------------ */
{a} .onglets-liste {{
  width: fit-content; height: auto; gap: 2px; padding: 3px;
  background: var(--lq-pilule);
  border: 1px solid var(--lq-filet-bleu);
  border-radius: 9px;
}}
{a} .onglet {{
  height: auto; margin: 0; padding: 6px 15px; border: 0; border-radius: 6px;
  font-family: {g}; font-size: 9.5px; font-weight: 500; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--lq-libelle);
}}
{a} .onglet:hover {{ color: var(--lq-fort); }}
{a} .onglet[data-state='active'], {a} .onglet[aria-current='page'] {{ color: var(--lq-actif-texte); background: var(--lq-actif); }}

/* --- Champs ----------------------------------------------------------------- */
{a} .champ-saisie {{
  font-family: "Inter Variable", sans-serif; font-size: 11.5px; font-weight: 300; letter-spacing: 0.02em; color: var(--lq-fort);
  background: var(--lq-creux);
  border: 1px solid var(--lq-filet-bleu);
  border-radius: 8px;
}}
{a} .champ-saisie::placeholder {{ color: var(--lq-libelle); opacity: 0.6; font-style: normal; }}
{a} .champ-saisie:focus-visible {{
  border-color: var(--lq-cyan-filet-fort);
  background: var(--lq-creux-focus);
  box-shadow: none;
}}
{a} select.champ-saisie option {{ background: var(--lq-surcouche); color: var(--lq-fort); }}
{a} label, {a} .sourcil {{ color: var(--lq-libelle); }}

/* --- Boutons à filet cyan --------------------------------------------------- */
{a} .bouton {{
  font-family: {g}; font-size: 9.5px; font-weight: 500; letter-spacing: 0.2em; text-transform: uppercase;
  border-radius: 10px;
}}
{a} .bouton[data-variante='principal'],
{a} .bouton[data-variante='primaire'],
{a} .bouton[data-variante='contour'] {{
  background: var(--lq-bouton);
  color: var(--lq-fort);
  border: 1px solid var(--lq-cyan-filet);
  box-shadow: none;
}}
{a} .bouton[data-variante='principal']:hover,
{a} .bouton[data-variante='primaire']:hover,
{a} .bouton[data-variante='contour']:hover {{
  background: var(--lq-bouton-survol);
  border-color: var(--lq-cyan-filet-fort);
}}
{a} .bouton[data-variante='danger'] {{
  background: transparent; color: var(--lq-erreur);
  border: 1px solid color-mix(in srgb, var(--lq-erreur) 45%, transparent);
}}
{a} .bouton[data-variante='discret'] {{ color: var(--lq-libelle); }}

/* --- Chiffres clés ---------------------------------------------------------- */
{a} .carte-stat .filet-stat {{ display: none; }}
{a} .carte-stat .pastille-stat {{ background: var(--lq-actif); color: var(--lq-cyan); }}
{a} .carte-stat .libelle-stat, {a} .carte-stat > div:first-child {{
  font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.2em; color: var(--lq-libelle);
}}
{a} .carte-stat .valeur-arrive,
{a} .carte-stat .tabular-nums {{ font-family: "Inter Variable", sans-serif; font-weight: 400; color: var(--lq-fort); }}
{a} .carte-stat[data-ton='alerte'] .tabular-nums,
{a} .carte-stat[data-ton='alerte'] .valeur-arrive {{ color: var(--lq-attente); }}
{a} .carte-stat[data-ton='danger'] .tabular-nums,
{a} .carte-stat[data-ton='danger'] .valeur-arrive,
{a} .carte-stat[data-ton='grave'] .valeur-arrive {{ color: var(--lq-erreur); }}
{a} .carte-stat[data-ton='succes'] .tabular-nums,
{a} .carte-stat[data-ton='succes'] .valeur-arrive {{ color: var(--lq-ok); }}

/* --- Tableau ---------------------------------------------------------------- */
{a} .cadre-table {{
  background: var(--lq-table);
  border: 1px solid var(--lq-filet-bleu);
  border-radius: 11px;
  box-shadow: var(--lq-ombre);
}}
{a} table.grille th {{
  font-family: "Inter Variable", sans-serif;
  font-size: 8.5px; font-weight: 500; letter-spacing: 0.24em;
  color: var(--lq-libelle);
  background: var(--lq-th);
  border-bottom: 1px solid var(--lq-filet-bleu);
}}
{a} table.grille td {{
  font-size: 11.5px; font-weight: 300; color: var(--lq-texte);
  background-color: transparent;
  border-color: var(--lq-filet-bleu);
}}
/* Les montants restent en Inter : Space Grotesk n'a pas l'espace fine des
   milliers, « 9 156 679,63 » s'y écrasait en « 9156679,63 ». */
{a} table.grille td.tabular-nums,
{a} table.grille td.text-right,
{a} .chiffres {{ font-family: "Inter Variable", sans-serif; color: var(--lq-fort); font-weight: 400; }}
{a} table.grille tbody tr:hover > td {{ background-color: var(--lq-survol); }}

/* --- Statuts : un point et un mot en capitales ------------------------------ */
{a} .etiquette[data-ton] {{
  display: inline-flex; align-items: center; gap: 6px;
  background: transparent; border: 0; box-shadow: none; padding: 0;
  font-size: 9px; font-weight: 500; letter-spacing: 0.16em; text-transform: uppercase;
}}
{a} .etiquette[data-ton]::before {{
  content: ""; width: 4px; height: 4px; border-radius: 50%; background: currentColor; flex: none;
}}
{a} .etiquette[data-ton='succes'] {{ color: var(--lq-ok); }}
{a} .etiquette[data-ton='alerte'] {{ color: var(--lq-attente); }}
{a} .etiquette[data-ton='danger'] {{ color: var(--lq-erreur); }}
{a} .etiquette[data-ton='info'],
{a} .etiquette[data-ton='accent'] {{ color: var(--lq-info); }}
{a} .etiquette[data-ton='neutre'],
{a} .etiquette[data-ton='contour'] {{ color: var(--lq-neutre); }}
{a} .etiquette[data-ton='or'] {{ color: var(--lq-or); }}

/* --- Interrupteurs et cases : le dégradé cyan → violet ---------------------- */
{a} button[role='switch'][data-state='checked'] {{
  background: linear-gradient(135deg, rgba(34, 211, 238, 0.55), rgba(139, 92, 246, 0.55));
  border-color: var(--lq-cyan-filet-fort);
}}
{a} input[type='checkbox'] {{ accent-color: var(--lq-cyan); }}

/* --- Menus et dialogues ----------------------------------------------------- */
{a} [role='dialog'],
{a} [role='menu'],
{a} [role='listbox'] {{
  background-color: var(--lq-surcouche);
  border-color: var(--lq-filet);
}}
"""



PALETTES = {
    # clé: (début, fin, primaire en clair, primaire en sombre)
    "indigo": ("#1E3A8A", "#4F46E5", "#4338CA", "#8B95E8"),
    "cyan": ("#0891B2", "#8B5CF6", "#0891B2", "#22D3EE"),
    "emeraude": ("#047857", "#10B981", "#047857", "#34D399"),
    "or": ("#8A6D2E", "#D4B26B", "#8A6D2E", "#D4B26B"),
    "ardoise": ("#334155", "#64748B", "#334155", "#A3B1C6"),
    "petrole": ("#155E75", "#0E9FB0", "#0E7490", "#5EC8D8"),
}


def bloc_personnalisation():
    """Les réglages fins d'Apparence (06/10/2026). Ils passent APRÈS les
    chartes et l'emportent sur elles : c'est un choix explicite de
    l'utilisateur, d'où quelques `!important` assumés."""
    p = []
    p.append("""
/* =============================================================================
   RÉGLAGES FINS (Apparence) — palette, police, cadres, fond, verre
   -----------------------------------------------------------------------------
   Posés sur <html> par `Apparence.tsx` : data-palette, data-police,
   data-cadres, data-fond, data-verre, et les variables --fond-*, --verre-*,
   --pal-1/--pal-2, --police-choisie. « auto » / « style » : la charte décide.
   ========================================================================== */

/* --- Police ------------------------------------------------------------------ */
:root[data-police]:not([data-police='auto']) body,
:root[data-police]:not([data-police='auto']) body *:not(svg):not(svg *) {
  font-family: var(--police-choisie) !important;
}

/* --- Fond : une couche fixe sous l'interface, avec ses filtres ---------------- */
.fond-perso { display: none; }
:root { --fond-defaut: url("/fond-ondes-clair.jpg"); --voile-rgb: 243 246 252; }
:root.sombre { --fond-defaut: url("/fond-ondes.jpg"); --voile-rgb: 4 5 10; }
:root[data-charte='graphite-verre'] { --fond-defaut: url("/fond-fils-graphite.jpg"); --voile-rgb: 4 5 10; }
:root[data-fond='perso'] .fond-perso {
  display: block;
  position: fixed;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
}
:root[data-fond='perso'] .fond-perso::before {
  content: "";
  position: absolute;
  inset: -40px;
  background-image: var(--fond-image, var(--fond-defaut));
  background-size: cover;
  background-repeat: no-repeat;
  background-position: var(--fond-pos, center);
  transform: scale(var(--fond-echelle, 1));
  filter: brightness(var(--fond-lum, 100%)) contrast(var(--fond-contraste, 100%))
          saturate(var(--fond-sat, 100%)) blur(var(--fond-flou, 0px));
}
:root[data-fond='perso'] .fond-perso::after {
  content: "";
  position: absolute;
  inset: 0;
  background: rgb(var(--voile-rgb) / var(--fond-voile, 0));
}
/* Le fond du style s'efface derrière l'image choisie. */
:root[data-fond='perso'] body { background: transparent !important; }
:root[data-fond='perso'] .coquille { background: transparent !important; }

/* --- Verre des panneaux ------------------------------------------------------ */
:root { --verre-rgb: 255 255 255; --verre-bord-rgb: 30 58 110; }
:root.sombre,
:root[data-charte='graphite-verre'] { --verre-rgb: 10 14 25; --verre-bord-rgb: 255 255 255; }
:root[data-verre='perso'] :is(.carte, .carte-stat, .cadre-table, .barre-laterale, .barre-haut, .entete-page) {
  background: rgb(var(--verre-rgb) / var(--verre-opacite, 0.72)) !important;
  backdrop-filter: blur(var(--verre-flou, 12px)) saturate(var(--verre-sat, 140%)) !important;
  border-color: rgb(var(--verre-bord-rgb) / var(--verre-bord-op, 0.12)) !important;
}
:root[data-verre='perso'] :is(.carte, .carte-stat, .cadre-table) {
  border-width: var(--verre-bord, 1px) !important;
  border-style: solid !important;
  border-radius: var(--verre-rayon, 16px) !important;
}
:root[data-verre='perso'] table.grille th { background-color: rgb(var(--verre-rgb) / 0.92) !important; }

/* --- Types de verre (maquette « verre net ») ----------------------------------- */
:root[data-verre='perso'][data-verre-type='strie'] :is(.carte, .carte-stat, .cadre-table, .barre-laterale, .barre-haut, .entete-page) {
  background:
    repeating-linear-gradient(90deg, rgb(var(--verre-bord-rgb) / 0.035) 0px, rgb(var(--verre-bord-rgb) / 0.035) 1px, transparent 1px, transparent 3px),
    rgb(var(--verre-rgb) / var(--verre-opacite, 0.72)) !important;
}
:root[data-verre='perso'][data-verre-type='bandes'] :is(.carte, .carte-stat, .cadre-table, .barre-laterale, .barre-haut, .entete-page) {
  background:
    linear-gradient(180deg,
      rgb(var(--verre-bord-rgb) / 0.10) 0%, rgb(var(--verre-bord-rgb) / 0.10) 25%,
      rgb(var(--verre-bord-rgb) / 0.06) 25%, rgb(var(--verre-bord-rgb) / 0.06) 50%,
      rgb(var(--verre-bord-rgb) / 0.03) 50%, rgb(var(--verre-bord-rgb) / 0.03) 75%,
      rgb(0 0 0 / 0.10) 75%, rgb(0 0 0 / 0.10) 100%),
    rgb(var(--verre-rgb) / var(--verre-opacite, 0.72)) !important;
}
:root[data-verre='perso'][data-verre-type='coupe'] :is(.carte, .carte-stat, .cadre-table, .barre-laterale, .barre-haut, .entete-page) {
  background:
    linear-gradient(135deg, rgb(var(--verre-bord-rgb) / 0.12) 0%, rgb(var(--verre-bord-rgb) / 0.12) 49.9%, rgb(0 0 0 / 0.15) 50%, rgb(0 0 0 / 0.15) 100%),
    rgb(var(--verre-rgb) / var(--verre-opacite, 0.72)) !important;
}

/* --- Boutons en verre, quand le verre est réglé ---------------------------------- */
:root[data-verre='perso'] .bouton {
  backdrop-filter: blur(calc(var(--verre-flou, 12px) * 0.6)) saturate(var(--verre-sat, 140%)) !important;
}
:root[data-verre='perso'] .bouton[data-variante='principal'],
:root[data-verre='perso'] .bouton[data-variante='primaire'] {
  background: linear-gradient(180deg, color-mix(in srgb, var(--pal-1, hsl(var(--primaire))) 62%, transparent), color-mix(in srgb, var(--pal-2, hsl(var(--primaire))) 48%, transparent)) !important;
  color: #FFFFFF !important;
  border: 1px solid rgb(255 255 255 / 0.28) !important;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.45), inset 0 -1px 0 rgb(0 0 0 / 0.12), 0 6px 18px -6px color-mix(in srgb, var(--pal-1, hsl(var(--primaire))) 55%, transparent) !important;
}
:root[data-verre='perso'] .bouton[data-variante='contour'],
:root[data-verre='perso'] .bouton[data-variante='discret']:hover {
  background: rgb(var(--verre-rgb) / calc(var(--verre-opacite, 0.72) * 0.6)) !important;
  border: 1px solid rgb(var(--verre-bord-rgb) / calc(var(--verre-bord-op, 0.12) + 0.1)) !important;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.35) !important;
}
:root[data-verre='perso'] .bouton[data-variante='danger'] {
  background: color-mix(in srgb, hsl(var(--danger)) 55%, transparent) !important;
  border: 1px solid rgb(255 255 255 / 0.25) !important;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.4) !important;
}
:root[data-verre='perso'] .bouton-menu,
:root[data-verre='perso'] .barre-haut button {
  backdrop-filter: blur(6px);
}
:root[data-verre='perso'] .champ-saisie {
  background: rgb(var(--verre-rgb) / calc(var(--verre-opacite, 0.72) * 0.7)) !important;
  backdrop-filter: blur(calc(var(--verre-flou, 12px) * 0.5));
}

/* --- Lisibilité : jamais un texte clair sur un fond clair ------------------------
   En mode clair, le texte courant reste en graisse normale, et les textes
   « atténués » ne descendent pas sous un gris franc. En sombre, l'inverse. */
:root:not(.sombre):not([data-charte='graphite-verre']) body { font-weight: 400 !important; }
:root:not(.sombre):not([data-charte='graphite-verre']) .text-attenue-texte\\/55,
:root:not(.sombre):not([data-charte='graphite-verre']) .text-attenue-texte\\/60,
:root:not(.sombre):not([data-charte='graphite-verre']) .text-attenue-texte\\/70 { color: hsl(var(--attenue-texte)) !important; }
:root[data-verre='perso']:not(.sombre) :is(.carte, .carte-stat, .cadre-table) { color: hsl(var(--texte)); }

/* --- Taille : un zoom de toute l'interface -------------------------------------
   La plupart des textes sont en pixels : changer la taille de base ne les
   bougeait pas. Le zoom agrandit ou réduit TOUT, sur toutes les pages ; la
   hauteur est compensée pour que l'écran reste rempli. Les dialogues, posés
   hors de l'application, suivent aussi. */
#root {
  zoom: var(--zoom-interface, 1);
  height: calc(100% / var(--zoom-interface, 1));
}
[role='dialog'], [role='alertdialog'] { zoom: var(--zoom-interface, 1); }

/* --- Cadres : avec ou sans dégradé ------------------------------------------- */
/* Avec : un filet dégradé autour des cartes et des tableaux, quel que soit le
   style. Le filet est un pseudo-élément masqué : il marche aussi sur du verre. */
:root[data-cadres='degrades'] :is(.carte, .cadre-table) { position: relative; }
:root[data-cadres='degrades'] :is(.carte, .cadre-table)::after {
  content: "";
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  padding: 1.5px;
  pointer-events: none;
  background: linear-gradient(135deg, var(--pal-1, hsl(var(--primaire))) 0%, var(--pal-2, hsl(var(--primaire) / 0.6)) 35%, transparent 75%, var(--pal-2, hsl(var(--primaire) / 0.5)) 100%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}
/* Sans : filets unis, aucune carte pleine en dégradé, aucune pastille dégradée. */
:root[data-cadres='simples'] .cadre-table,
:root[data-cadres='simples'] .carte {
  background: hsl(var(--surface)) !important;
  border: 1px solid hsl(var(--bordure)) !important;
}
:root[data-cadres='simples'][data-verre='perso'] :is(.cadre-table, .carte) {
  background: rgb(var(--verre-rgb) / var(--verre-opacite, 0.72)) !important;
}
:root[data-cadres='simples']:not([data-charte='liquid-glass']) .bouton[data-variante='principal'],
:root[data-cadres='simples']:not([data-charte='liquid-glass']) .bouton[data-variante='primaire'] {
  background: hsl(var(--primaire)) !important;
  color: hsl(var(--primaire-texte)) !important;
}
:root[data-cadres='simples'] .lien-nav.actif { background: hsl(var(--barre-actif)) !important; box-shadow: none !important; }
:root[data-cadres='simples']:not([data-charte='liquid-glass']):not([data-charte='graphite-verre']) .lien-nav.actif,
:root[data-cadres='simples']:not([data-charte='liquid-glass']):not([data-charte='graphite-verre']) .lien-nav.actif svg { color: hsl(var(--primaire)) !important; }
""")
    # --- Palettes ---------------------------------------------------------------
    for cle, (d, f, pc, ps) in PALETTES.items():
        a = f":root[data-palette='{cle}']"
        p.append(f"""
/* Palette « {cle} » */
{a} {{
  --primaire: {hsl(pc)};
  --anneau: {hsl(pc)};
  --primaire-texte: 0 0% 100%;
  --degrade-action: linear-gradient(135deg, {d} 0%, {f} 100%);
  --degrade-cadre: linear-gradient(135deg, {d} 0%, {f} 30%, color-mix(in srgb, {f} 45%, white) 70%, color-mix(in srgb, {f} 15%, white) 100%);
  --degrade-entete-table: linear-gradient(180deg, color-mix(in srgb, {f} 8%, white) 0%, color-mix(in srgb, {f} 14%, white) 100%);
  --lq-cyan: {pc};
  --lq-actif: color-mix(in srgb, {pc} 14%, transparent);
  --lq-actif-texte: {pc};
  --lq-cyan-filet: color-mix(in srgb, {pc} 38%, transparent);
  --lq-cyan-filet-fort: color-mix(in srgb, {pc} 75%, transparent);
}}
{a}.sombre,
:root[data-charte='graphite-verre']{a[5:]} {{
  --primaire: {hsl(ps)};
  --anneau: {hsl(ps)};
  --primaire-texte: 222 30% 8%;
  --degrade-entete-table: linear-gradient(180deg, color-mix(in srgb, {f} 14%, #10131c) 0%, color-mix(in srgb, {f} 8%, #10131c) 100%);
  --lq-cyan: {ps};
  --lq-actif: color-mix(in srgb, {ps} 18%, transparent);
  --lq-actif-texte: #FFFFFF;
  --lq-cyan-filet: color-mix(in srgb, {ps} 38%, transparent);
  --lq-cyan-filet-fort: color-mix(in srgb, {ps} 75%, transparent);
}}
/* Les chartes qui figent leur bouton et leur écran actif suivent la palette. */
{a}:not([data-charte='liquid-glass']):not([data-cadres='simples']) .bouton[data-variante='principal'],
{a}:not([data-charte='liquid-glass']):not([data-cadres='simples']) .bouton[data-variante='primaire'] {{
  background: linear-gradient(135deg, {d} 0%, {f} 100%) !important;
  color: #FFFFFF !important;
}}
{a}:is([data-charte='sobre'], [data-charte='graphite-verre']) .lien-nav.actif,
{a}:is([data-charte='sobre'], [data-charte='graphite-verre']) .lien-nav.actif svg {{ color: hsl(var(--primaire)) !important; }}
{a}:is([data-charte='sobre'], [data-charte='graphite-verre']) .lien-nav.actif::before {{ background: hsl(var(--primaire)) !important; }}
{a} .onglet[data-state='active'], {a} .onglet[aria-current='page'] {{ border-color: hsl(var(--primaire)); }}
{a}:is([data-charte='sobre']) .carte-stat .filet-stat {{ background: linear-gradient(180deg, {d}, {f}); }}
{a}:is([data-charte='graphite-verre']) table.grille th {{ color: hsl(var(--primaire)); border-bottom-color: color-mix(in srgb, {ps} 40%, transparent); }}
""")
    return "".join(p)

css = ENTETE + bloc_classique() + bloc_degrades() + bloc_full() + bloc_sobre() + bloc_graphite() + bloc_liquide() + bloc_personnalisation()
open(SORTIE, "w", encoding="utf-8").write(css)
print("écrit", SORTIE, len(css.splitlines()), "lignes")
