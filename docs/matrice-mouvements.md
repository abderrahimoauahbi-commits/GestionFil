# Matrice des mouvements de stock

> Généré par `python db/pg/matrice.py` depuis `backend/tests/banc/matrice_mouvements.json`.
> Ne pas éditer à la main : le banc (`matrice_mouvements`) vérifie le fichier source contre la base.

**Règles communes.** Le kilogramme est l'unité ; le stock d'un magasin ne passe jamais sous zéro (R02) ;
le grand livre (`ligne_mouvement`) est immuable et fait foi, `stock_magasin` n'en est que le cache (C11) ;
le stock par lot suit quand la ligne porte un lot. Seule une ENTRÉE valorisée touche le CMUP
(contrainte `type_mouvement_cmup_entree`) ; chaque sortie porte son coût, le CMUP du moment (10/10/2026).
Le fil en route (transfert expédié, pas encore reçu) compte dans la valeur du stock et dans le calcul
des besoins, pour son magasin de destination.

| Type | Sens | CMUP | Coût porté par la ligne | Exige | Réversibilité |
|---|---|---|---|---|---|
| `ENTREE_REC` | + | Moyenne pondérée : (stock × CMUP + kg × prix) ÷ (stock + kg), dans le magasin de destination | Prix d'achat en devise × taux ENGAGÉ du bon, 4 décimales (frais d'import ajoutés à la clôture du dossier) | prix | Contre-passation (la valeur sort À SON PRIX, dans son seul magasin) tant que la réception n'est pas clôturée et que le dossier d'import n'est pas dédouané ; ensuite avoir ou retour fournisseur. La réception ne se dévalide qu'après |
| `RETOUR_FOURN` | − | Sortie au prix du retour : la différence avec le CMUP va au stock restant du magasin (jamais sous zéro), le reste au journal des écarts | CMUP du magasin au moment de la sortie, corrigé au prix du retour | motif de ligne | Aucune : le retour validé est définitif, son mouvement ne se contre-passe pas (RFO-DEFINITIF) |
| `STOCK_INIT` | + | Moyenne pondérée au prix saisi ; sans prix, prix catalogue converti si le magasin n'a pas encore de CMUP | Prix saisi (ou catalogue converti) | — | Contre-passation |
| `SORTIE_PROD` | − | Inchangé | CMUP du magasin au moment de la sortie | OF | Contre-passation |
| `CONSO_DIRECTE` | − | Inchangé | CMUP du magasin au moment de la sortie | — | Contre-passation |
| `RETOUR_CONSO` | + | Inchangé (la matière revient au CMUP courant) | Sans prix saisi : valorisé au CMUP du magasin | — | Contre-passation (et la sortie ne se contre-passe pas tant qu'un retour de son OF en dépend) |
| `RETOUR_PROD` | + | Inchangé (le fil revient au CMUP courant) | Sans prix : valorisé au CMUP du magasin | motif de ligne | Contre-passation |
| `SORTIE_HORS_MACHINE` | − | Inchangé | CMUP du magasin au moment de la sortie | motif de ligne | Contre-passation |
| `RETOUR_PRET` | + | Inchangé (au CMUP en cours) | Sans prix : valorisé au CMUP du magasin | — | Contre-passation |
| `AJUST_INV_POS` | + | Inchangé | Sans prix : valorisé au CMUP du magasin | motif de ligne | Aucune : c'est lui la correction (on n'annule pas une annulation, on saisit ce qui manque) |
| `AJUST_INV_NEG` | − | Inchangé ; une contre-passation d'ENTRÉE retire en plus la valeur de l'entrée à son prix (fn_cmup_annuler_entree) | CMUP du magasin au moment de la sortie | motif de ligne | Aucune : c'est lui la correction |
| `TRANSFERT_SORTIE` | − | Inchangé au départ | CMUP du départ, FIGÉ sur la ligne de transfert : il voyage avec le fil | — | Pas seule (une moitié de transfert) : annuler le transfert, ou corriger par un inventaire |
| `TRANSFERT_ENTREE` | + | Moyenne pondérée au CMUP FIGÉ AU DÉPART (pas au CMUP du départ le jour de l'arrivée) | CMUP figé au départ | — | Pas seule (une moitié de transfert) |
| `FUSION_SORTIE` | − (interne) | Inchangé (même magasin, même référence) | Sans prix | — | Pas seule : se défait en entier |
| `FUSION_ENTREE` | + (interne) | Inchangé | Sans prix | — | Pas seule : se défait en entier |
| `CHARGE_MACHINE` | − | Inchangé | CMUP du magasin au chargement | — | Par la fiche seulement (dévalider ou annuler la décision tête de l'étage, mouvements ANNUL_* liés) |
| `RETOUR_MACHINE` | + | Moyenne pondérée au prix du chargement | Prix du chargement | — | Par la fiche seulement |
| `ANNUL_CHARGE_MACHINE` | + (interne) | Moyenne pondérée au prix du chargement annulé | Prix du chargement annulé | prix | Aucune : c'est lui l'annulation |
| `ANNUL_RETOUR_MACHINE` | − (interne) | Inchangé | CMUP du magasin | — | Aucune : c'est lui l'annulation |

## Achats

### `ENTREE_REC`

- **Origine** : Validation d'une réception locale (contrôle) ou d'une réception d'import
- **Sens** : entrée (+) dans le magasin du mouvement ; le stock du lot suit
- **CMUP** : Moyenne pondérée : (stock × CMUP + kg × prix) ÷ (stock + kg), dans le magasin de destination
- **Coût de la ligne** : Prix d'achat en devise × taux ENGAGÉ du bon, 4 décimales (frais d'import ajoutés à la clôture du dossier)
- **Validation** : Droit VALIDER des réceptions ; le valideur n'est pas l'auteur de la dernière pesée
- **Réversibilité** : Contre-passation (la valeur sort À SON PRIX, dans son seul magasin) tant que la réception n'est pas clôturée et que le dossier d'import n'est pas dédouané ; ensuite avoir ou retour fournisseur. La réception ne se dévalide qu'après
- **Prouvé par le banc** : `cmup_chiffre`, `reception_cloture_avoir`, `reception_devalidee_revalidee`, `import`

### `RETOUR_FOURN`

- **Origine** : Validation d'un retour fournisseur libre (Achats → Retours fournisseur), par un autre compte que l'auteur
- **Sens** : sortie (−) dans le magasin du mouvement ; le stock du lot suit
- **CMUP** : Sortie au prix du retour : la différence avec le CMUP va au stock restant du magasin (jamais sous zéro), le reste au journal des écarts
- **Coût de la ligne** : CMUP du magasin au moment de la sortie, corrigé au prix du retour
- **Validation** : Droit ECRIRE des réceptions pour saisir le retour, VALIDER pour le valider (un autre compte)
- **Réversibilité** : Aucune : le retour validé est définitif, son mouvement ne se contre-passe pas (RFO-DEFINITIF)
- **Prouvé par le banc** : `saisie_libre`, `retour_cloture_avoirs`

### `STOCK_INIT`

- **Origine** : Reprise du stock de départ
- **Sens** : entrée (+) dans le magasin du mouvement ; le stock du lot suit
- **CMUP** : Moyenne pondérée au prix saisi ; sans prix, prix catalogue converti si le magasin n'a pas encore de CMUP
- **Coût de la ligne** : Prix saisi (ou catalogue converti)
- **Validation** : Droit ECRIRE du stock
- **Réversibilité** : Contre-passation
- **Prouvé par le banc** : `saisie_libre`


## Production et sorties

### `SORTIE_PROD`

- **Origine** : Déchet de production : rebut, chute non réutilisable (motif R4 imposé ; ordre de fabrication en texte libre)
- **Sens** : sortie (−) dans le magasin du mouvement ; le stock du lot suit
- **CMUP** : Inchangé
- **Coût de la ligne** : CMUP du magasin au moment de la sortie
- **Validation** : Droit ECRIRE du stock ; au-delà de 50 kg cumulés par jour et par référence (sorties hors machine comprises), droit VALIDER de l'inventaire
- **Réversibilité** : Contre-passation
- **Prouvé par le banc** : `stock_jamais_negatif`, `contre_passation`, `saisie_libre`

### `CONSO_DIRECTE`

- **Origine** : Consommation directe d'une matière qui ne va pas sur machine (jute, latex, SBR, plastique, simili cuir : fiche article en mode DIRECTE) ; OF facultatif : avec lui, la qualité de l'OF ; sans lui, la qualité est obligatoire (23/10/2026)
- **Sens** : sortie (−) dans le magasin du mouvement ; le stock du lot suit
- **CMUP** : Inchangé
- **Coût de la ligne** : CMUP du magasin au moment de la sortie
- **Validation** : Droit ECRIRE du stock, sans seuil ; refusée par la base pour un article en mode MACHINE (le fil sort par les fiches machine)
- **Réversibilité** : Contre-passation
- **Prouvé par le banc** : `consommation_directe`, `fiche_hors_machine`

### `RETOUR_CONSO`

- **Origine** : Retour au magasin d'une matière hors machine (fiche article en mode DIRECTE) non consommée par l'OF — ou, sans OF, la qualité (23/10/2026) — qui l'avait sortie (fiche hors machine, 22/10/2026) ; consommation = sorti − rendu
- **Sens** : entrée (+) dans le magasin du mouvement ; le stock du lot suit
- **CMUP** : Inchangé (la matière revient au CMUP courant)
- **Coût de la ligne** : Sans prix saisi : valorisé au CMUP du magasin
- **Validation** : Droit ECRIRE du stock ; l'OF (lien) est obligatoire ; refusé par la base pour un article en mode MACHINE et au-delà de ce que l'OF a sorti de cette référence, non encore rendu
- **Réversibilité** : Contre-passation (et la sortie ne se contre-passe pas tant qu'un retour de son OF en dépend)
- **Prouvé par le banc** : `fiche_hors_machine`

### `RETOUR_PROD`

- **Origine** : Retour depuis l'atelier ; au grand livre de la consommation, déduit du réel au jour du retour (nature RETOUR_PROD, arbitrage du 27/10/2026)
- **Sens** : entrée (+) dans le magasin du mouvement ; le stock du lot suit
- **CMUP** : Inchangé (le fil revient au CMUP courant)
- **Coût de la ligne** : Sans prix : valorisé au CMUP du magasin
- **Validation** : Droit ECRIRE du stock
- **Réversibilité** : Contre-passation
- **Prouvé par le banc** : `saisie_libre`, `retour_prod_grand_livre`

### `SORTIE_HORS_MACHINE`

- **Origine** : Sortie hors machine : atelier, échantillon, essai, réparation, prêt à une autre usine
- **Sens** : sortie (−) dans le magasin du mouvement ; le stock du lot suit
- **CMUP** : Inchangé
- **Coût de la ligne** : CMUP du magasin au moment de la sortie
- **Validation** : Droit ECRIRE du stock ; au-delà de 50 kg cumulés par jour et par référence (déchets compris), droit VALIDER de l'inventaire
- **Réversibilité** : Contre-passation
- **Prouvé par le banc** : `sortie_hors_machine`, `cmup_chiffre`, `concurrence_stock`

### `RETOUR_PRET`

- **Origine** : Retour en nature d'un prêt à une autre usine
- **Sens** : entrée (+) dans le magasin du mouvement ; le stock du lot suit
- **CMUP** : Inchangé (au CMUP en cours)
- **Coût de la ligne** : Sans prix : valorisé au CMUP du magasin
- **Validation** : Droit ECRIRE du stock ; ne rend pas plus que ce qui reste à rendre
- **Réversibilité** : Contre-passation
- **Prouvé par le banc** : `sortie_hors_machine`


## Inventaire et corrections

### `AJUST_INV_POS`

- **Origine** : Clôture d'inventaire (compté > théorique) ; contre-passation d'une sortie
- **Sens** : entrée (+) dans le magasin du mouvement ; le stock du lot suit
- **CMUP** : Inchangé
- **Coût de la ligne** : Sans prix : valorisé au CMUP du magasin
- **Validation** : Droit VALIDER de l'inventaire
- **Réversibilité** : Aucune : c'est lui la correction (on n'annule pas une annulation, on saisit ce qui manque)
- **Prouvé par le banc** : `inventaire`, `cmup_chiffre`, `contre_passation`

### `AJUST_INV_NEG`

- **Origine** : Clôture d'inventaire (compté < théorique) ; contre-passation d'une entrée
- **Sens** : sortie (−) dans le magasin du mouvement ; le stock du lot suit
- **CMUP** : Inchangé ; une contre-passation d'ENTRÉE retire en plus la valeur de l'entrée à son prix (fn_cmup_annuler_entree)
- **Coût de la ligne** : CMUP du magasin au moment de la sortie
- **Validation** : Droit VALIDER de l'inventaire
- **Réversibilité** : Aucune : c'est lui la correction
- **Prouvé par le banc** : `inventaire`, `cmup_chiffre`


## Transferts (le fil en route entre les deux)

### `TRANSFERT_SORTIE`

- **Origine** : Expédition d'un transfert, au magasin de départ : le fil part EN ROUTE
- **Sens** : sortie (−) dans le magasin du mouvement ; le stock du lot suit
- **CMUP** : Inchangé au départ
- **Coût de la ligne** : CMUP du départ, FIGÉ sur la ligne de transfert : il voyage avec le fil
- **Validation** : Droit ECRIRE du stock
- **Réversibilité** : Pas seule (une moitié de transfert) : annuler le transfert, ou corriger par un inventaire
- **Prouvé par le banc** : `cmup_chiffre`, `atomicite`

### `TRANSFERT_ENTREE`

- **Origine** : Réception d'un transfert, au magasin d'arrivée
- **Sens** : entrée (+) dans le magasin du mouvement ; le stock du lot suit
- **CMUP** : Moyenne pondérée au CMUP FIGÉ AU DÉPART (pas au CMUP du départ le jour de l'arrivée)
- **Coût de la ligne** : CMUP figé au départ
- **Validation** : Droit ECRIRE du stock
- **Réversibilité** : Pas seule (une moitié de transfert)
- **Prouvé par le banc** : `cmup_chiffre`


## Lots

### `FUSION_SORTIE`

- **Origine** : Fusion de lots : le lot absorbé sort ; ou reconditionnement (06/11/2026) : le dérivé de départ sort, dans le même lot (motif RECONDITIONNEMENT)
- **Sens** : sortie (−) dans le magasin du mouvement ; le stock du lot suit
- **CMUP** : Inchangé (même magasin, même référence)
- **Coût de la ligne** : Sans prix
- **Validation** : Droit ECRIRE des lots ; fusion autorisée par la référence
- **Réversibilité** : Pas seule : se défait en entier
- **Prouvé par le banc** : `lots_autorisations`

### `FUSION_ENTREE`

- **Origine** : Fusion de lots : le lot résultant entre ; ou reconditionnement (06/11/2026) : le dérivé d'arrivée entre, dans le même lot (motif RECONDITIONNEMENT)
- **Sens** : entrée (+) dans le magasin du mouvement ; le stock du lot suit
- **CMUP** : Inchangé
- **Coût de la ligne** : Sans prix
- **Validation** : Droit ECRIRE des lots
- **Réversibilité** : Pas seule : se défait en entier
- **Prouvé par le banc** : `lots_autorisations`


## Machines

### `CHARGE_MACHINE`

- **Origine** : Fiche machine : chargement d'un étage (le fil quitte le magasin)
- **Sens** : sortie (−) dans le magasin du mouvement ; le stock du lot suit
- **CMUP** : Inchangé
- **Coût de la ligne** : CMUP du magasin au chargement
- **Validation** : Décision machine (seuils vert / orange / rouge)
- **Réversibilité** : Par la fiche seulement (dévalider ou annuler la décision tête de l'étage, mouvements ANNUL_* liés)
- **Prouvé par le banc** : `machine`, `machine_surplus`, `machine_constat`

### `RETOUR_MACHINE`

- **Origine** : Fiche machine : retour du fil d'un étage au magasin
- **Sens** : entrée (+) dans le magasin du mouvement ; le stock du lot suit
- **CMUP** : Moyenne pondérée au prix du chargement
- **Coût de la ligne** : Prix du chargement
- **Validation** : Décision machine
- **Réversibilité** : Par la fiche seulement
- **Prouvé par le banc** : `machine`

### `ANNUL_CHARGE_MACHINE`

- **Origine** : Annulation d'une décision machine : le chargement revient au magasin
- **Sens** : entrée (+) dans le magasin du mouvement ; le stock du lot suit
- **CMUP** : Moyenne pondérée au prix du chargement annulé
- **Coût de la ligne** : Prix du chargement annulé
- **Validation** : Auteur de la décision le jour même, ou Direction / Admin
- **Réversibilité** : Aucune : c'est lui l'annulation
- **Prouvé par le banc** : `machine`

### `ANNUL_RETOUR_MACHINE`

- **Origine** : Annulation d'une décision machine : le retour repart sur la machine
- **Sens** : sortie (−) dans le magasin du mouvement ; le stock du lot suit
- **CMUP** : Inchangé
- **Coût de la ligne** : CMUP du magasin
- **Validation** : Auteur de la décision le jour même, ou Direction / Admin
- **Réversibilité** : Aucune : c'est lui l'annulation
- **Prouvé par le banc** : `machine`
