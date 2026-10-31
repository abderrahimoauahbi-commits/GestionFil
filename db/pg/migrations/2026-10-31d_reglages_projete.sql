-- =============================================================================
-- 2026-10-31d — Stock projeté : les réglages de l'entreprise (31/10/2026)
-- =============================================================================
-- Décision du 31/10/2026 (« fais tous ») : chaque hypothèse du stock projeté
-- devient un réglage global, que suit le plan d'achat. Chacun démarre sur le
-- comportement d'avant : rien ne change tant qu'on n'y touche pas.
--
--   P_ProjeteRattrapage    1  le manque avant un arrivage tardif reste dû
--                             (0 : il est perdu) ; le bouton de l'écran part de là ;
--   P_ProjeteAgeConstatMax 0  sans limite ; N > 0 : le fil d'un constat machine
--                             plus vieux que N jours ne compte plus ;
--   P_ProjeteQuarantaine   0  la quarantaine ne compte pas (1 : comptée, urgence) ;
--   P_ProjeteRetardJours   0  un bon en retard compte aujourd'hui (N : + N jours) ;
--   P_ProjeteSansDate      0  un arrivage sans date est hors calcul
--                             (1 : compté à aujourd'hui + délai) ;
--   P_ProjeteMinMultiple   1  minimum de commande et multiple appliqués (0 : non) ;
--   P_ProjeteMinimumAlerte 1  le stock minimum entre dans le seuil d'alerte (0 : non).
--
-- Aucun objet créé. Rejouable.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

INSERT INTO parametre (code_parametre, libelle, valeur_courante, type_donnee, unite, description,
                       categorie, modifiable_par, verrouille) VALUES
 ('P_ProjeteRattrapage', 'Stock projeté : rattrapage par défaut (1 = inclus, 0 = exclu)', '1', 'ENTIER', NULL,
  'Le manque avant un arrivage tardif : 1 = il reste dû et se déduit de l''arrivage ; 0 = il est perdu. Le plan d''achat suit ce réglage ; le bouton Rattrapage de l''écran en part.',
  'STOCK', 'DIRECTION', 0),
 ('P_ProjeteAgeConstatMax', 'Stock projeté : âge maximum d''un constat machine', '0', 'ENTIER', 'jours',
  'Au-delà de ce nombre de jours, le fil d''un constat machine ne compte plus dans le stock du projeté. 0 = sans limite (le dernier constat compte, quel que soit son âge).',
  'STOCK', 'DIRECTION', 0),
 ('P_ProjeteQuarantaine', 'Stock projeté : quarantaine comptée (1 = oui, 0 = non)', '0', 'ENTIER', NULL,
  'En urgence, la quarantaine peut compter dans le stock du projeté. 0 = non (par défaut).',
  'STOCK', 'DIRECTION', 0),
 ('P_ProjeteRetardJours', 'Stock projeté : décalage d''un bon en retard', '0', 'ENTIER', 'jours',
  'Un bon dont la date prévue est passée compte à aujourd''hui + ce nombre de jours. 0 = aujourd''hui.',
  'STOCK', 'DIRECTION', 0),
 ('P_ProjeteSansDate', 'Stock projeté : arrivage sans date compté (1 = oui, 0 = non)', '0', 'ENTIER', NULL,
  'Un bon validé sans date de livraison : 0 = hors calcul (par défaut) ; 1 = compté à aujourd''hui + délai du fournisseur.',
  'STOCK', 'DIRECTION', 0),
 ('P_ProjeteMinMultiple', 'Stock projeté : minimum et multiple appliqués (1 = oui, 0 = non)', '1', 'ENTIER', NULL,
  'La quantité proposée est portée au minimum de commande puis arrondie au multiple (ou à la palette). 0 = le besoin brut.',
  'STOCK', 'DIRECTION', 0),
 ('P_ProjeteMinimumAlerte', 'Stock projeté : stock minimum dans le seuil d''alerte (1 = oui, 0 = non)', '1', 'ENTIER', NULL,
  'Seuil d''alerte = sécurité de la classe ABC + stock minimum en jours de plan. 0 = la sécurité seule.',
  'STOCK', 'DIRECTION', 0)
ON CONFLICT (code_parametre) DO NOTHING;

DO $$
BEGIN
    IF (SELECT count(*) FROM parametre WHERE code_parametre IN
          ('P_ProjeteRattrapage', 'P_ProjeteAgeConstatMax', 'P_ProjeteQuarantaine', 'P_ProjeteRetardJours',
           'P_ProjeteSansDate', 'P_ProjeteMinMultiple', 'P_ProjeteMinimumAlerte')) <> 7 THEN
        RAISE EXCEPTION '2026-10-31d : réglages du stock projeté incomplets.';
    END IF;
END $$;

COMMIT;
