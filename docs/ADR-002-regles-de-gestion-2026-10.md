# ADR-002 — Les 18 règles de gestion du 08/10/2026

**Statut** : accepté · **Date** : 2026-10-08 · **Portée** : réceptions, valorisation, lots, machines, stock, planification, droits

La Direction a validé ces 18 règles le 08/10/2026. Les audits v3 et v4 du même jour en ont vérifié
l'application ; ce document dit, pour chacune, **ce qui a été décidé**, **où c'est garanti**, et **ce
qui le contrôle**. Les migrations citées sont dans `db/pg/migrations/`, le banc de tests dans
`backend/tests/banc/` (`python backend\tests\banc\banc.py`).

Principe directeur, conforme à l'ADR-001 D-04 : l'invariant est en base quand il peut l'être, la
cascade dans le service, et l'écran ne fait que refléter ce que le serveur impose.

Préférence de l'utilisateur, valable pour tous les contrôles de vraisemblance : **signaler, ne pas
bloquer** (avis à l'écran + contrôle `Cxx`), sauf quand la règle elle-même dit de refuser.

---

## Machines

### R1 — Écart machine : vert, orange, rouge

**Décision** — L'écart d'une ligne (kg avant + chargés − retirés − kg après) se classe vert jusqu'à
MAX(10 kg, 1 % de la ligne), orange au-delà, rouge au-delà de MAX(50 kg, 5 %). **Seuls les écarts
non expliqués se jugent** (décision de l'audit v4) : une consommation, un déchet, une perte ou une
casse déclarés au bon motif restent verts. Orange : confirmé avant la validation. Rouge : droit de
valider l'inventaire (Direction) et commentaire obligatoire.

**Où** — `domain/decision_machine.rs` (`calculer`, `valider`) ; niveau archivé sur
`machine_decision_ligne.niveau_ecart` (08b) ; orange confirmé au serveur (`confirme_orange`) ; seuils
`P_MachineEcart*`. **Contrôle** — banc `machine`.

### R2 — Poids nominal figé au chargement

**Décision** — Le poids d'une bobine d'une ligne est celui fixé à son chargement ; un changement du
catalogue ne crée pas d'écart. Pour une ligne nouvelle, le poids déclaré fait foi (serveur et écran).

### R3 — Mouvements internes neutres

**Décision** — Chargement, retour machine, transfert, fusion ne changent pas la valeur : ils
déplacent au coût moyen.

### R4 — Seules la consommation, le déchet et la casse sortent de la valeur

**Décision** — Le reste se déplace. **Réserve connue** : le retour fournisseur sort au coût moyen ; sa
contrepartie attendue est un avoir du fournisseur, saisi sur la réception d'origine (R8).

---

## Lots

### R5 — Dérogation de lot

**Décision** — Bloquer, débloquer, accorder une dérogation, décider d'un lot dormant : droit VALIDER
du module LOTS, ou la Direction. Un accord se motive comme un refus ; une seule réponse par demande.
La dérogation qui débloque un **chargement de lot bloqué** se demande depuis la fiche machine
refusée et sert **une fois**, pour ce lot et cette fiche.

**Où** — `routes/lots.rs` ; `2026-10-08e_lots_derogation.sql` (déclencheur `fn_trg_lmvt_lot_controle`,
`date_consommation`) ; `seed_006` pour les droits d'une base neuve. **Contrôle** — banc
`lots_autorisations`.

### R11 — Lot bloqué : production interdite, retour machine permis

**Décision** — Un lot bloqué ne part ni en production, ni sur machine, ni en fusion ; il peut revenir
d'une machine, aller en quarantaine, retourner au fournisseur.

**Où** — déclencheur `fn_trg_lmvt_lot_controle` ; `decision_machine::controles_complementaires`.

### R13 — Dérive fournisseur à la réception initiale

**Décision** — Le poids réel par bobine se mesure à la réception initiale seulement (pas aux
transferts ni aux retours). Les bobines d'un fil suivi au lot se **comptent** : exigées à la
soumission au contrôle, jamais déduites des kilos ni recopiées de la facture.

**Où** — `v_lot_variation` (08e : réception initiale, hors contre-passation) ;
`reception::exiger_bobines_comptees` et son pendant à l'import.

---

## Réceptions et valorisation

### R6 — Valorisation en deux temps

**Décision** — À la validation, la marchandise entre au prix du bon (provisoire). La facture, avec ses
frais, la rend définitive à la clôture : la différence va aux **lots de la réception encore en stock,
là où ils sont** (à défaut, son magasin) ; la part des kilos sortis va en écart de prix, hors coût
moyen. La facture se saisit dans la devise du bon, au cours Bank Al-Maghrib de sa date ; elle peut
couvrir plusieurs réceptions du fournisseur. Un écart de plus de 10 % lève un avis, sans bloquer.

**Où** — `domain/facture_locale.rs` ; `reception_ajustements_cmup` (journal immuable, origine
CLOTURE / AVOIR / COMPLEMENT) ; 08b section 6. **Contrôle** — banc `reception_cloture_avoir`.

### R7 — Local et import, même moteur

**Décision** — La clôture d'un dossier d'import porte ses frais par le même calcul : lots du dossier,
répartition signée (une reclôture à la baisse retire), consommé hors coût moyen. Même tolérance (celle
du fournisseur), même contrôle de cours.

**Où** — `domain/importation.rs` (`cloturer`, `repartir_signe`, `verifier_ecarts`). **Contrôle** — banc
`import`.

### R8 — Après dédouanement ou clôture : pas d'annulation

**Décision** — Une réception d'import dédouanée, une réception locale clôturée ne se contre-passent ni
ne se dévalident : la correction est un **avoir** (ou une facture complémentaire), motivé, journalisé.
Avant la DUM, la contre-passation annule la réception d'import et rend facture et bon cohérents ; une
facture dont une ligne est reçue est figée.

**Où** — `routes/stock.rs::contre_passer` ; `facture_locale::corriger` (`/api/receptions/{id}/avoir`) ;
`2026-10-08f_import_coherence.sql`. **Contrôle** — bancs `reception_cloture_avoir`, `import_coherence`.

### R14 — Tolérance du fournisseur, excédent seul

**Décision** — Seul l'excédent au-delà de la tolérance du fournisseur (à défaut `P_TolerEcartPesee`,
2 %) demande une dérogation motivée ; un manque est une livraison partielle. L'écart se rejuge contre
le **reste courant du bon** à la soumission et à la validation.

**Où** — `fn_tolerance_pesee`, `fn_tolerance_fournisseur` ; `reception::verifier_ecarts_courants` ;
`importation::verifier_ecarts` ; C10 (local et import). **Contrôle** — banc `ecart_pesee`.

---

## Stock et inventaire

### R10 — Inventaire

**Décision** — Un seul inventaire en cours par magasin ; celui qui compte ne clôture pas (droit de
valider l'inventaire) ; un inventaire s'annule avec un motif ; le théorique est pris à l'heure du
comptage.

**Où** — `domain/inventaire.rs` ; index `ux_inventaire_ouvert` ; C44. **Contrôle** — banc
`inventaire`.

**Complément du 13/10/2026** — L'inventaire suit le cycle d'un bon : **Brouillon** (créé, lignes
préparées d'emblée, le magasinier compte) → **Validé** (un autre compte que ceux qui ont compté,
droit Valider, l'Administrateur dispensé ; comptage figé, stock intact ; « Renvoyer au comptage »
avec motif le rouvre) → **Clôturé** (droit Valider, écarts au stock). L'ancien état `EN_COURS`
devient `BROUILLON`. Une liste, puis une page par inventaire (en-tête et lignes). Garanties en
base : `trg_inventaire_separation` (INV-SEPARATION), `trg_ligne_inventaire_fige` (INV-FIGE), un
seul inventaire brouillon ou validé par magasin. Migration `2026-10-13b_inventaire_valide.sql`.

### R12 — Saisie libre : ajustements et déchets au coût moyen

**Décision** — La saisie libre se limite aux ajustements, déchets, consommation hors machine (sur un
OF) et retours fournisseur ; le prix est toujours le coût moyen en cours. Ajustement et déchet de plus
de 50 kg : droit de valider l'inventaire. Retour fournisseur : droit de valider les réceptions,
rattaché à sa réception, plafonné à ce qu'elle a fait entrer (décision 5 de l'audit v4).

**Où** — `routes/stock.rs::creer_mouvement`. **Contrôle** — banc `saisie_libre`.

---

## Planification

### R9 — Stock machine dans le MRP

**Décision** — Le fil sur machine compte comme stock disponible (`P_MrpInclureStockMachine`), s'il a
été constaté depuis moins de `P_JoursInventMachine` jours (30) et que le lot n'est pas bloqué ; il se
lit à part dans le plan d'achat et l'écran de stock ; il n'entre pas dans le stock substituable ni
dans C27.

**Où** — `v_stock_physique.stock_mrp_net_kg` (08b section 4).

### R17 — Proposition écartée : 90 jours

**Décision** — Une proposition d'achat écartée masque le besoin pendant `P_DureeEcartJours` (90), puis
expire et le besoin est reproposé.

### R18 — Taux de référence de moins de 7 jours

**Décision** — Un bon en devise ne se valide pas sur un taux de plus de `P_AncienneteTauxJours` (7)
jours. Une ligne de bon en devise sans taux en vigueur ne se reçoit pas (plus de repli au taux 1).

Compléments de l'audit v4 (décision 6) : le mois en cours ne compte que ses jours restants ; au-delà
du plan, la demande se prolonge à sa moyenne (`P_HorizonProlonge`) ; une commande en retard reste en
en-cours (`P_EncoursRetardInclus`) ; la marchandise d'import facturée et non reçue compte en en-cours
(08h).

---

## Droits

### R15 — Tout retour arrière exige VALIDER

**Décision** — Quitter un état engagé (validé, envoyé, en service, clôturé) pour reculer, être annulé
ou sortir de service sans exécution exige le droit VALIDER du module ; quand le retour a sa procédure
(dévalidation avec motif et garde de stock), les routes de statut y renvoient.

**Où** — `domain/transitions.rs` (testé) ; `devalidation.rs`.

### R16 — Montants masqués partout

**Décision** — Un montant masqué à un utilisateur ne sort par aucune route : la grille du module fait
foi pour les champs qu'il déclare ; un montant non déclaré est masqué à qui il est masqué ailleurs. On
ne trie ni ne filtre sur un champ masqué.

**Où** — `auth/mod.rs::masquer`, `rbac.rs` ; champs déclarés par 08b section 1 et `seed_006` ;
`crud.rs::lister`. **Contrôle** — bancs `masquage`, `sessions`.

---

## Arbitrages du 09/10/2026 (audit v5)

Tranchés un par un avec l'utilisateur, règles d'abord, puis fonctionnalités, puis technique. Les
migrations `2026-10-09a` à `2026-10-09y` les portent ; chacune est exigée au démarrage
(`MIGRATIONS_REQUISES`) et le banc les vérifie.

### A1 — Sortie hors machine

**Décision** — Le fil peut sortir hors machine, en petites quantités : consommation d'atelier (jute,
latex, plastique, cuir), échantillon, essai, réparation, prêt à une autre usine, autre. Motif de ligne
obligatoire ; l'OF est un texte libre, jamais vérifié (l'ERP ne gère pas la production). Au-delà de
50 kg cumulés par jour et par référence, VALIDER. Le prêt se suit en restes à rendre (`v_prets_en_cours`,
C47) ; le retour de prêt (RETOUR_PRET) ne rend pas plus que ce qui a été prêté. Tranché le
10/10/2026 : le prêt est **toujours rendu en nature**, jamais refacturé ; il n'y a donc pas de sortie
« vendue » à prévoir.

**Où** — `SORTIE_HORS_MACHINE`, `RETOUR_PRET` (09d) ; `routes/stock.rs`. **Contrôle** — banc
`sortie_hors_machine`.

### A2 — Consommation déclarée au chargement

**Décision** — Vert si la consommation ne dépasse pas ce que la ligne portait avant le chargement ; le
surplus passe ORANGE avec une raison choisie dans une liste (saisie décalée, oubli de constat, erreur de
report) ; la fiche est listée (C48). La « Correction » n'a plus de passe-droit : son écart est jugé par
les seuils, rouge = droit de valider l'inventaire.

**Où** — `decision_machine.rs` (RAISONS_SURPLUS). **Contrôle** — banc `machine_surplus`.

### A3 — Avoirs typés, local et import

**Décision** — Le type est obligatoire. Avoir de PRIX : baisse le CMUP du stock restant de la
réception (ou du dossier), la part sortie au journal des écarts de prix ; ciblable par référence ; la
part qui ferait passer le CMUP sous zéro va au journal (U6). Avoir pour RETOUR : rattaché aux retours
fournisseur, plafonné à leur valeur, sans effet sur le CMUP ; la différence au journal. Facture nette
ou brute : les deux pratiques coexistent, la clôture demande laquelle quand des retours existent.

**Où** — `facture_locale.rs`, `importation.rs::avoir` (09g, 09n). **Contrôle** — bancs
`retour_cloture_avoirs`, `import`.

### A4 — Pesée au contrôle

**Décision** — Le valideur n'est jamais l'auteur de la dernière pesée (local et import). Au contrôle,
la pesée est figée ; le contrôleur renvoie au magasinier avec un motif, qui corrige et resoumet. Les
bobines se revérifient à la validation.

**Où** — `fn_trg_reception_valideur_pas_peseur`, `fn_trg_pesee_auteur` (09f). **Contrôle** — banc
`controle_reception`.

### A5 — Vie du dossier d'import

**Décision** — Avant clôture, les frais sont libres et journalisés. La DUM se corrige avec VALIDER et un
motif, ne s'efface jamais ; dès la DUM, plus de contre-passation (R8). Clos, le dossier ne se rouvre
plus ; une facture tardive passe en frais post-clôture, répartie sur le stock restant.

**Où** — 09h ; `importation.rs::frais_post_cloture`. **Contrôle** — banc `import`.

### A6 — Sous-livraison dans la tolérance

**Décision** — À la validation, une ligne reçue à au moins commandé × (1 − tolérance du fournisseur) est
soldée ; toutes les lignes soldées, le bon se clôt. Au-delà, le reliquat reste ; l'abandonner relève de
VALIDER.

**Où** — `reception.rs`, `importation.rs`, migration 09i (rattrapage journalisé).

### A7 — Retrait d'une décision machine rouge

**Décision** — Faux problème : un rouge est validé par qui a le droit de valider l'inventaire, et seul
l'auteur le jour même, ou ce même droit, la retire. Les noms de rôle écrits en dur sont remplacés par
la grille (T11).

### A8 — Prix du plan d'achat

**Décision** — Dans l'ordre : dernier prix d'achat (dernier bon validé chez ce fournisseur, au taux du
jour), prix catalogue, CMUP — dans ce dernier cas seulement, le prix est masqué à qui ne voit pas le
CMUP et la proposition est marquée « prix à saisir ».

**Où** — `fn_dernier_prix_achat_mad`, `v_plan_achat` (09j) ; `masquer_prix_au_cmup`.

### A9 — Horizon prolongé et saisons

**Décision** — Au-delà du plan, la demande se prolonge à la moyenne du plan × le coefficient du mois
(table `saison_mois`, réglable, défaut 1). Signalés : part prolongée > 50 % d'une proposition (C49),
écart plan/réel > 50 % après 6 mois (C50) ; rapport « stocks minimums à revoir » au besoin mensuel du
plan. Le détail de chaque proposition se lit pas à pas (F16).

**Où** — 09k, 09o ; `PlanAchatDetail.tsx`. **Contrôle** — banc `plan_detail`.

### A10 — Taux d'un bon en devise

**Décision** — Proposé au cours du jour de la validation, modifiable avec un motif ; au-delà de 3 % du
cours BAM, à confirmer ; le plafond de validation se juge sur le plus grand des deux ; figé à la
validation avec sa justification (taux, date du cours, source, valideur). Le bon imprimé porte la date
de validation comme date de commande.

**Où** — 09l ; `routes/stock.rs`. **Contrôle** — banc `taux_bon`.

### A11 — Le change au paiement des importations

**Décision** — Le CMUP reste au cours du dédouanement, comme la comptabilité : le paiement ne le touche
jamais. Le coût de revient réel se lit à part, par dossier : matière + frais + écart de change constaté
à chaque paiement (cours de la banque), coupé au cours BAM du 31/12 pour les dossiers dédouanés une
année et payés la suivante. Pas d'écriture comptable. Tranché le 10/10/2026 : il n'y a **jamais
d'acompte avant le dédouanement**. Un paiement daté avant la DUM (à défaut, la facture) est donc une
erreur de date probable : la saisie l'accepte avec un avis, et C53 le signale.

**Où** — `paiement_facture_import`, `v_change_paiement`, `v_cout_revient_reel` (09m), `v_ctl_c53`
(10a) ; `CoutRevientReel.tsx`. **Contrôle** — banc `import` (paiement de la veille signalé).

---

## Ce qui reste ouvert

- R4 : la contrepartie du retour fournisseur (avoir) n'est pas imposée à sa saisie.
- Les dates sont du texte ISO garanti par contrainte (08m) ; leur conversion en type `date` reste un
  chantier à part.
