-- ==========================================================================
-- MIGRATION 2026-09-18h — LE STOCK INITIAL VIENT DE « Liste ref fil.xlsx »
-- --------------------------------------------------------------------------
-- Les feuilles POLYFASHION et MOROCCO remplacent la situation du 5 septembre
-- chargee par 2026-09-18b. Elles comptent en PALETTES ; on convertit :
--
--     kg = palettes x bobines/palette x poids d'une bobine x (1 - machine%)
--
-- LE POURCENTAGE « MACHINE » SORT DU CALCUL, ET C'EST UN CHOIX : il designe
-- la part deja montee sur les machines, qui n'est plus au magasin. Palettes
-- brutes : 316 273 kg ; part machine retiree : 64 724 kg ; il reste 251 549 kg.
-- Aucun stock machine n'est cree ici : ce sera un autre geste.
--
-- ON EFFACE L'ANCIEN SOCLE, ET LE GRAND LIVRE L'INTERDIT (R03). L'exception
-- se justifie parce que ce grand livre NE CONTIENT QUE CE SOCLE : aucune
-- reception, aucune sortie, aucun transfert. Effacer une amorce de
-- parametrage n'efface aucune histoire. La garde ci-dessous le verifie et
-- ARRETE TOUT si un seul mouvement d'exploitation est apparu entre-temps :
-- il faudrait alors corriger par inventaire, pas par suppression.
--
-- SANS PRIX : ce stock n'a connu aucun achat dans l'ERP. Le CMUP suit le
-- prix catalogue au taux en vigueur (2026-09-17h et 2026-09-18e), et la
-- premiere reception moyennera avec lui.
--
-- Les kilos sont THEORIQUES, et `mode_pesee` le dit ligne par ligne.
--
-- Rejouable : l'effacement ne se declenche que si l'ancien socle est la, et
-- les insertions ne se font qu'une fois.
-- ==========================================================================

BEGIN;

-- ---------------------------------------------------------------- LA GARDE
DO $$
DECLARE n_autres bigint; n_rec bigint;
BEGIN
    SELECT count(*) INTO n_autres FROM mouvement WHERE code_type_mvt <> 'STOCK_INIT';
    SELECT count(*) INTO n_rec FROM ligne_reception;
    IF n_autres > 0 OR n_rec > 0 THEN
        RAISE EXCEPTION 'Le grand livre porte % mouvement(s) d''exploitation et % ligne(s) de reception : le socle initial ne peut plus etre remplace, il faut corriger par inventaire (AJUST_INV_POS / AJUST_INV_NEG).', n_autres, n_rec;
    END IF;
END $$;

-- ----------------------------------------------- L'ANCIEN SOCLE S'EFFACE
DO $$
DECLARE n_lignes bigint; n_kg numeric;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM mouvement WHERE numero_mouvement IN ('MVT-INIT-SIT-MORO', 'MVT-INIT-SIT-POLY')) THEN
        RAISE NOTICE 'ancien socle deja retire — rien a effacer';
        RETURN;
    END IF;
    SELECT count(*), round(coalesce(sum(lm.quantite_kg), 0)) INTO n_lignes, n_kg
      FROM ligne_mouvement lm JOIN mouvement m USING (id_mouvement)
     WHERE m.numero_mouvement IN ('MVT-INIT-SIT-MORO', 'MVT-INIT-SIT-POLY');
    RAISE NOTICE 'effacement de l''ancien socle : % lignes, % kg', n_lignes, n_kg;

    -- R03 interdit la suppression. On ne contourne pas la regle en douce : on
    -- la suspend pour ces deux mouvements, le temps de la transaction, et on
    -- la remet aussitot. La garde ci-dessus a prouve qu'aucune histoire reelle
    -- n'est en jeu.
    ALTER TABLE ligne_mouvement DISABLE TRIGGER trg_lmvt_immuable_d;
    ALTER TABLE mouvement      DISABLE TRIGGER trg_mouvement_immuable_d;

    DELETE FROM ligne_mouvement WHERE id_mouvement IN
        (SELECT id_mouvement FROM mouvement WHERE numero_mouvement IN ('MVT-INIT-SIT-MORO', 'MVT-INIT-SIT-POLY'));
    DELETE FROM mouvement WHERE numero_mouvement IN ('MVT-INIT-SIT-MORO', 'MVT-INIT-SIT-POLY');

    ALTER TABLE ligne_mouvement ENABLE TRIGGER trg_lmvt_immuable_d;
    ALTER TABLE mouvement      ENABLE TRIGGER trg_mouvement_immuable_d;

    -- Les soldes sont DERIVES du grand livre : sans mouvement, ils n'ont plus
    -- de raison d'etre. Ils se reconstruisent seuls a l'insertion suivante,
    -- par le declencheur trg_lmvt_appliquer.
    DELETE FROM stock_magasin;
END $$;

-- ------------------------------------------------------- LE NOUVEAU SOCLE

-- POLYFASHION : 49 references, 134 013.4 kg
INSERT INTO mouvement (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt,
                       code_magasin, code_motif, reference_document, id_utilisateur, est_initial)
SELECT '7c1e4f02-3a55-4d18-9b6e-0f2a8c5d1e47', 'MVT-INIT-LRF-POLY', '2026-09-18T12:00:00.000Z', 'STOCK_INIT', 'Polyfashions', 'INIT',
       'Liste ref fil.xlsx — feuille POLYFASHION, hors part machine',
       (SELECT id_utilisateur FROM utilisateur WHERE login = 'admin'), 1
 WHERE NOT EXISTS (SELECT 1 FROM mouvement WHERE numero_mouvement = 'MVT-INIT-LRF-POLY');

-- MOROCCO : 13 references, 117 535.6 kg
INSERT INTO mouvement (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt,
                       code_magasin, code_motif, reference_document, id_utilisateur, est_initial)
SELECT 'b4d9a713-6e28-4c90-8f15-2a7b3e6c9d04', 'MVT-INIT-LRF-MORO', '2026-09-18T12:00:00.000Z', 'STOCK_INIT', 'Morocco', 'INIT',
       'Liste ref fil.xlsx — feuille MOROCCO, hors part machine',
       (SELECT id_utilisateur FROM utilisateur WHERE login = 'admin'), 1
 WHERE NOT EXISTS (SELECT 1 FROM mouvement WHERE numero_mouvement = 'MVT-INIT-LRF-MORO');

INSERT INTO ligne_mouvement (id_mouvement, ligne_numero, code_reference, quantite_kg,
                             quantite_saisie, unite_saisie, facteur_conversion, nb_bobines, mode_pesee)
SELECT m.id_mouvement, v.ligne_numero, v.code_reference, v.quantite_kg,
       v.quantite_saisie, 'Palette', v.facteur_conversion, v.nb_bobines, 'THEORIQUE'
  FROM (VALUES
    ('MVT-INIT-LRF-POLY', 1::bigint, 'PES Fdy-1500 Deniers-Gold Fdy-33005-Gzm', 1512.0000::numeric, 1.3500::numeric, 1120.0000::numeric, 605::bigint),
    ('MVT-INIT-LRF-POLY', 2::bigint, 'PES Fdy-1500 Deniers-Taupe Fdy-811100-Gzm', 3584.0000::numeric, 3.2000::numeric, 1120.0000::numeric, 1434::bigint),
    ('MVT-INIT-LRF-POLY', 3::bigint, 'PES Fdy -1800 Deniers-Gold Cf-101 Turk', 1456.0000::numeric, 1.3000::numeric, 1120.0000::numeric, 582::bigint),
    ('MVT-INIT-LRF-POLY', 4::bigint, 'Micro PES-3600 Deniers Ivory 15-Tat', 682.0800::numeric, 0.7000::numeric, 974.4000::numeric, 235::bigint),
    ('MVT-INIT-LRF-POLY', 5::bigint, 'Micro PES-7360 Deniers-Multi L.Beige 1305-130-Suj', 1182.7200::numeric, 1.2000::numeric, 985.6000::numeric, 538::bigint),
    ('MVT-INIT-LRF-POLY', 6::bigint, 'Micro PES-7360 Deniers-Multi L.Brown 1305-61-Suj', 2710.4000::numeric, 2.7500::numeric, 985.6000::numeric, 1232::bigint),
    ('MVT-INIT-LRF-POLY', 7::bigint, 'PES-3000 Deniers- Bleu Ssl2244-Suj', 2744.0000::numeric, 2.8000::numeric, 980.0000::numeric, 1098::bigint),
    ('MVT-INIT-LRF-POLY', 8::bigint, 'PES-3000 Deniers- Dk.Vison Ssl2176-Suj', 637.0000::numeric, 0.6500::numeric, 980.0000::numeric, 255::bigint),
    ('MVT-INIT-LRF-POLY', 9::bigint, 'PES-3000 Deniers- Pink Ssl2259-Suj', 637.0000::numeric, 0.6500::numeric, 980.0000::numeric, 255::bigint),
    ('MVT-INIT-LRF-POLY', 10::bigint, 'PES-3000 Deniers- Vison Ssl2247-Suj', 1568.0000::numeric, 1.6000::numeric, 980.0000::numeric, 627::bigint),
    ('MVT-INIT-LRF-POLY', 11::bigint, 'PES-3000 Deniers- WhiteSsl2331-Suj', 1568.0000::numeric, 1.6000::numeric, 980.0000::numeric, 627::bigint),
    ('MVT-INIT-LRF-POLY', 12::bigint, 'PES Ver-1500 Deniers-BleuTex-8100 Text', 1010.8800::numeric, 1.3000::numeric, 777.6000::numeric, 562::bigint),
    ('MVT-INIT-LRF-POLY', 13::bigint, 'PES Ver-1500 Deniers-TerraTex-8000 Text', 505.4400::numeric, 0.6500::numeric, 777.6000::numeric, 281::bigint),
    ('MVT-INIT-LRF-POLY', 14::bigint, 'PES -1200 Deniers-Anty Bordeau 61043-Gzm', 2284.8000::numeric, 3.0000::numeric, 761.6000::numeric, 1344::bigint),
    ('MVT-INIT-LRF-POLY', 15::bigint, 'PES -1500 Deniers-D.Bleu 1271-Gzm', 672.0000::numeric, 0.6000::numeric, 1120.0000::numeric, 269::bigint),
    ('MVT-INIT-LRF-POLY', 16::bigint, 'PES -1500 Deniers-Bordeau 61043-Gzm', 4300.8000::numeric, 4.8000::numeric, 896.0000::numeric, 2150::bigint),
    ('MVT-INIT-LRF-POLY', 17::bigint, 'PES Sh-1200 Deniers-Cream B-Cb -1005 Sf', 5691.8400::numeric, 7.7000::numeric, 739.2000::numeric, 2587::bigint),
    ('MVT-INIT-LRF-POLY', 18::bigint, 'PES Sh-1200 Deniers-Beige Cp-1432 Sf', 2365.4400::numeric, 3.2000::numeric, 739.2000::numeric, 1075::bigint),
    ('MVT-INIT-LRF-POLY', 19::bigint, 'PES Sh-1200 Deniers-Antrasit 802-Tat', 4300.8000::numeric, 4.8000::numeric, 896.0000::numeric, 2150::bigint),
    ('MVT-INIT-LRF-POLY', 20::bigint, 'PES Sh-1200 Deniers-Cpbt Grey 801-Tat', 5913.6000::numeric, 6.6000::numeric, 896.0000::numeric, 2957::bigint),
    ('MVT-INIT-LRF-POLY', 21::bigint, 'PES Sh -1200 Deniers-Grey Cb-7A Turk', 2540.1600::numeric, 3.6000::numeric, 705.6000::numeric, 1210::bigint),
    ('MVT-INIT-LRF-POLY', 22::bigint, 'PES Sh-1200 Deniers- Cream Dtbc-H69-Gzm', 4390.4000::numeric, 4.9000::numeric, 896.0000::numeric, 2195::bigint),
    ('MVT-INIT-LRF-POLY', 23::bigint, 'PES Sh-1500 Deniers-D.Vizon Cp-2068 Sf', 4139.5200::numeric, 5.6000::numeric, 739.2000::numeric, 1882::bigint),
    ('MVT-INIT-LRF-POLY', 24::bigint, 'PES Sh-1500 Deniers-Vizon Cp-2018 Sf', 4139.5200::numeric, 5.6000::numeric, 739.2000::numeric, 1882::bigint),
    ('MVT-INIT-LRF-POLY', 25::bigint, 'PES Sh-1500 Deniers-Beige Cp-2039 Sf', 4139.5200::numeric, 5.6000::numeric, 739.2000::numeric, 1882::bigint),
    ('MVT-INIT-LRF-POLY', 26::bigint, 'PES Sh-1500 Deniers- L.Beige H-2000-Tat', 658.5600::numeric, 0.7000::numeric, 940.8000::numeric, 314::bigint),
    ('MVT-INIT-LRF-POLY', 27::bigint, 'PES Sh-1500 Deniers-Cream H-1008-Tat', 1411.2000::numeric, 1.5000::numeric, 940.8000::numeric, 672::bigint),
    ('MVT-INIT-LRF-POLY', 28::bigint, 'PES Sh-1500 Deniers-D.VizonTex-7521 Text', 3104.6400::numeric, 3.6000::numeric, 862.4000::numeric, 1411::bigint),
    ('MVT-INIT-LRF-POLY', 29::bigint, 'PES Sh-1500 Deniers-VizonTex-7530 Text', 3234.0000::numeric, 3.7500::numeric, 862.4000::numeric, 1470::bigint),
    ('MVT-INIT-LRF-POLY', 30::bigint, 'PES Sh-1500 Deniers-Beige Tex-7500 Text', 4225.7600::numeric, 4.9000::numeric, 862.4000::numeric, 1921::bigint),
    ('MVT-INIT-LRF-POLY', 31::bigint, 'PP-1500 Dtex-Cream 2951-Hs', 2246.4000::numeric, 3.0000::numeric, 748.8000::numeric, 864::bigint),
    ('MVT-INIT-LRF-POLY', 32::bigint, 'PP-1500 Dtex-L.Beige 44377-Hs', 3294.7200::numeric, 4.4000::numeric, 748.8000::numeric, 1267::bigint),
    ('MVT-INIT-LRF-POLY', 33::bigint, 'PP-1750*2 Dtex-Sh Creme 2981 Hs', 446.4000::numeric, 0.6000::numeric, 744.0000::numeric, 144::bigint),
    ('MVT-INIT-LRF-POLY', 34::bigint, 'PP-1900 Dtex-D.Green 5455-Hs', 3124.8000::numeric, 4.2000::numeric, 744.0000::numeric, 1008::bigint),
    ('MVT-INIT-LRF-POLY', 35::bigint, 'PP FRZ-2900 Dtex-Black 8001-Hs', 2764.8000::numeric, 3.6000::numeric, 768.0000::numeric, 864::bigint),
    ('MVT-INIT-LRF-POLY', 36::bigint, 'PP FRZ-2900 Dtex-Beige 44360-Hs', 3686.4000::numeric, 4.8000::numeric, 768.0000::numeric, 1152::bigint),
    ('MVT-INIT-LRF-POLY', 37::bigint, 'PP FRZ-2900 Dtex-Brown 44361-Hs', 2995.2000::numeric, 3.9000::numeric, 768.0000::numeric, 936::bigint),
    ('MVT-INIT-LRF-POLY', 38::bigint, 'PP FRZ-2900 Dtex-Camel 44416-Hs', 3072.0000::numeric, 4.0000::numeric, 768.0000::numeric, 960::bigint),
    ('MVT-INIT-LRF-POLY', 39::bigint, 'PP FRZ-2900 Dtex-Cream 44412-Hs', 2764.8000::numeric, 3.6000::numeric, 768.0000::numeric, 864::bigint),
    ('MVT-INIT-LRF-POLY', 40::bigint, 'PP FRZ-2900 Dtex-D.Bleu 6417-Hs', 1843.2000::numeric, 2.4000::numeric, 768.0000::numeric, 576::bigint),
    ('MVT-INIT-LRF-POLY', 41::bigint, 'PP FRZ-2900 Dtex-D.Green 5463-Hs', 6758.4000::numeric, 8.8000::numeric, 768.0000::numeric, 2112::bigint),
    ('MVT-INIT-LRF-POLY', 42::bigint, 'PP FRZ-2900 Dtex-Grey 10575-Hs', 268.8000::numeric, 0.3500::numeric, 768.0000::numeric, 84::bigint),
    ('MVT-INIT-LRF-POLY', 43::bigint, 'PP FRZ-2900 Dtex-Pink 7639-Hs', 3686.4000::numeric, 4.8000::numeric, 768.0000::numeric, 1152::bigint),
    ('MVT-INIT-LRF-POLY', 44::bigint, 'PP FRZ-2900 Dtex- Red 7612-Hs', 10598.4000::numeric, 13.8000::numeric, 768.0000::numeric, 3312::bigint),
    ('MVT-INIT-LRF-POLY', 45::bigint, 'PP-1775*2 Dtex-Cream 1072-Tat', 940.8000::numeric, 1.4000::numeric, 672.0000::numeric, 470::bigint),
    ('MVT-INIT-LRF-POLY', 46::bigint, 'PP-1775*2 Dtex-White 1073-Tat', 3494.4000::numeric, 5.2000::numeric, 672.0000::numeric, 1747::bigint),
    ('MVT-INIT-LRF-POLY', 47::bigint, 'PP-1500 Dtex-Bleu 7201-Oz', 374.4000::numeric, 0.5000::numeric, 748.8000::numeric, 144::bigint),
    ('MVT-INIT-LRF-POLY', 48::bigint, 'PP-1500 Dtex-D.Bleu 7200-Oz', 748.8000::numeric, 1.0000::numeric, 748.8000::numeric, 288::bigint),
    ('MVT-INIT-LRF-POLY', 49::bigint, 'PP-1500 Dtex-Yellow 3151-Oz', 3594.2400::numeric, 4.8000::numeric, 748.8000::numeric, 1382::bigint),
    ('MVT-INIT-LRF-MORO', 1::bigint, 'PES-3000 Deniers- Bleu Ssl2244-Suj', 3920.0000::numeric, 4.0000::numeric, 980.0000::numeric, 1568::bigint),
    ('MVT-INIT-LRF-MORO', 2::bigint, 'PES-3000 Deniers- Dark Grey Ssl2069-Suj', 23030.0000::numeric, 23.5000::numeric, 980.0000::numeric, 9212::bigint),
    ('MVT-INIT-LRF-MORO', 3::bigint, 'PES-3000 Deniers- Khave Ssl2279-Suj', 3430.0000::numeric, 3.5000::numeric, 980.0000::numeric, 1372::bigint),
    ('MVT-INIT-LRF-MORO', 4::bigint, 'PES-3000 Deniers- Seker Cream Ssl2081-Suj', 20580.0000::numeric, 21.0000::numeric, 980.0000::numeric, 8232::bigint),
    ('MVT-INIT-LRF-MORO', 5::bigint, 'PES-3000 Deniers- Vison Ssl2247-Suj', 14700.0000::numeric, 15.0000::numeric, 980.0000::numeric, 5880::bigint),
    ('MVT-INIT-LRF-MORO', 6::bigint, 'PES-3000 Deniers- WhiteSsl2331-Suj', 490.0000::numeric, 0.5000::numeric, 980.0000::numeric, 196::bigint),
    ('MVT-INIT-LRF-MORO', 7::bigint, 'PES -1200 Deniers-Anty Bordeau 61043-Gzm', 8377.6000::numeric, 11.0000::numeric, 761.6000::numeric, 4928::bigint),
    ('MVT-INIT-LRF-MORO', 8::bigint, 'PP FRZ-2900 Dtex-Black 8001-Hs', 4608.0000::numeric, 6.0000::numeric, 768.0000::numeric, 1440::bigint),
    ('MVT-INIT-LRF-MORO', 9::bigint, 'PP FRZ-2900 Dtex-Beige 44360-Hs', 13056.0000::numeric, 17.0000::numeric, 768.0000::numeric, 4080::bigint),
    ('MVT-INIT-LRF-MORO', 10::bigint, 'PP FRZ-2900 Dtex-Brown 44361-Hs', 6144.0000::numeric, 8.0000::numeric, 768.0000::numeric, 1920::bigint),
    ('MVT-INIT-LRF-MORO', 11::bigint, 'PP FRZ-2900 Dtex-Camel 44416-Hs', 5376.0000::numeric, 7.0000::numeric, 768.0000::numeric, 1680::bigint),
    ('MVT-INIT-LRF-MORO', 12::bigint, 'PP FRZ-2900 Dtex-Grey 10575-Hs', 3840.0000::numeric, 5.0000::numeric, 768.0000::numeric, 1200::bigint),
    ('MVT-INIT-LRF-MORO', 13::bigint, 'PP FRZ-2900 Dtex- Red 7612-Hs', 9984.0000::numeric, 13.0000::numeric, 768.0000::numeric, 3120::bigint)
  ) AS v(numero, ligne_numero, code_reference, quantite_kg, quantite_saisie,
         facteur_conversion, nb_bobines)
  JOIN mouvement m ON m.numero_mouvement = v.numero
 WHERE NOT EXISTS (SELECT 1 FROM ligne_mouvement x
                    WHERE x.id_mouvement = m.id_mouvement AND x.ligne_numero = v.ligne_numero);

-- ------------------------------------------------------------ LA PREUVE
DO $$
DECLARE n_lignes bigint; kg numeric; n_soldes bigint; kg_soldes numeric;
BEGIN
    SELECT count(*), round(sum(lm.quantite_kg), 1) INTO n_lignes, kg
      FROM ligne_mouvement lm JOIN mouvement m USING (id_mouvement)
     WHERE m.numero_mouvement IN ('MVT-INIT-LRF-POLY', 'MVT-INIT-LRF-MORO');
    SELECT count(*), round(sum(quantite_kg), 1) INTO n_soldes, kg_soldes
      FROM stock_magasin WHERE quantite_kg <> 0;
    IF n_lignes <> 62 THEN
        RAISE EXCEPTION 'attendu 62 lignes de socle, trouve %', n_lignes;
    END IF;
    IF abs(kg - 251549.0) > 0.5 THEN
        RAISE EXCEPTION 'attendu 251549.0 kg, trouve % kg', kg;
    END IF;
    IF n_soldes <> n_lignes OR abs(kg_soldes - kg) > 0.5 THEN
        RAISE EXCEPTION 'les soldes (% lignes, % kg) ne suivent pas le grand livre (% lignes, % kg)', n_soldes, kg_soldes, n_lignes, kg;
    END IF;
    RAISE NOTICE 'socle initial : % lignes, % kg, soldes conformes', n_lignes, kg;
END $$;

COMMIT;
