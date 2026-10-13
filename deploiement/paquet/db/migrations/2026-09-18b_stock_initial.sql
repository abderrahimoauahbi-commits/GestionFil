-- ===========================================================================
-- MIGRATION 2026-09-18b — LA SITUATION DE STOCK DU 5 SEPTEMBRE 2026
-- ---------------------------------------------------------------------------
-- 292 413 kg, 75 soldes, deux magasins. SANS PRIX : ce stock n'a connu aucun achat
-- dans l'ERP. La base lui donne le prix catalogue au taux en vigueur
-- (2026-09-17h), et la premiere reception moyennera avec lui.
--
-- Les kilos sont THEORIQUES — palettes x bobines par palette x poids d'une
-- bobine — et `mode_pesee = 'THEORIQUE'` le dit ligne par ligne.
--
-- Rejouable : rien n'est ecrit si ces mouvements existent deja. Un mouvement
-- ne se modifie pas ; on ne le repose donc jamais par-dessus.
-- ===========================================================================

BEGIN;

INSERT INTO mouvement (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt,
                       code_magasin, code_motif, reference_document, id_utilisateur, est_initial)
SELECT '99f26ca1-0075-4937-92cd-8b06ce5b63c5', 'MVT-INIT-SIT-MORO', '2026-09-17T13:47:12.878Z', 'STOCK_INIT', 'Morocco', 'INIT', 'situation stock 1.xlsx du 05/09/2026',
       (SELECT id_utilisateur FROM utilisateur WHERE login = 'admin'), 1
 WHERE NOT EXISTS (SELECT 1 FROM mouvement WHERE numero_mouvement = 'MVT-INIT-SIT-MORO');

INSERT INTO mouvement (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt,
                       code_magasin, code_motif, reference_document, id_utilisateur, est_initial)
SELECT '0d06d4fa-9634-4a6a-bcee-49719480416b', 'MVT-INIT-SIT-POLY', '2026-09-17T13:47:12.878Z', 'STOCK_INIT', 'Polyfashions', 'INIT', 'situation stock 1.xlsx du 05/09/2026',
       (SELECT id_utilisateur FROM utilisateur WHERE login = 'admin'), 1
 WHERE NOT EXISTS (SELECT 1 FROM mouvement WHERE numero_mouvement = 'MVT-INIT-SIT-POLY');

INSERT INTO ligne_mouvement (id_mouvement, ligne_numero, code_reference, quantite_kg,
                             quantite_saisie, unite_saisie, facteur_conversion, nb_bobines, mode_pesee)
SELECT m.id_mouvement, v.ligne_numero, v.code_reference, v.quantite_kg,
       v.quantite_saisie, v.unite_saisie, v.facteur_conversion, v.nb_bobines, v.mode_pesee
  FROM (VALUES
    ('MVT-INIT-SIT-MORO', 1::bigint, 'PES-3000 Deniers- Dark Grey Ssl2069-Suj', 23030.0000::numeric, 23.5000::numeric, 'Palette', 980.0000::numeric, 9212::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-MORO', 2::bigint, 'PES-3000 Deniers- Khave Ssl2279-Suj', 3430.0000::numeric, 3.5000::numeric, 'Palette', 980.0000::numeric, 1372::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-MORO', 3::bigint, 'PES-3000 Deniers- Seker Cream Ssl2081-Suj', 20580.0000::numeric, 21.0000::numeric, 'Palette', 980.0000::numeric, 8232::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-MORO', 4::bigint, 'PES-3000 Deniers- Vison Ssl2247-Suj', 14700.0000::numeric, 15.0000::numeric, 'Palette', 980.0000::numeric, 5880::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-MORO', 5::bigint, 'PES-3000 Deniers- WhiteSsl2331-Suj', 490.0000::numeric, 0.5000::numeric, 'Palette', 980.0000::numeric, 196::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-MORO', 6::bigint, 'PP FRZ-2900 Dtex- Grey 8933-Hs', 4536.0000::numeric, 6.0000::numeric, 'Palette', 756.0000::numeric, 1440::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-MORO', 7::bigint, 'PP FRZ-2900 Dtex- Red 7612-Hs', 17388.0000::numeric, 23.0000::numeric, 'Palette', 756.0000::numeric, 5520::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-MORO', 8::bigint, 'PP FRZ-2900 Dtex-Beige 44360-Hs', 12852.0000::numeric, 17.0000::numeric, 'Palette', 756.0000::numeric, 4080::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-MORO', 9::bigint, 'PP FRZ-2900 Dtex-Black 8001-Hs', 9828.0000::numeric, 13.0000::numeric, 'Palette', 756.0000::numeric, 3120::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-MORO', 10::bigint, 'PP FRZ-2900 Dtex-Brown 44361-Hs', 9072.0000::numeric, 12.0000::numeric, 'Palette', 756.0000::numeric, 2880::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-MORO', 11::bigint, 'PP FRZ-2900 Dtex-Camel 44416-Hs', 5292.0000::numeric, 7.0000::numeric, 'Palette', 756.0000::numeric, 1680::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-MORO', 12::bigint, 'PP FRZ-2900 Dtex-Cream 44412-Hs', 6048.0000::numeric, 8.0000::numeric, 'Palette', 756.0000::numeric, 1920::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-MORO', 13::bigint, 'PP FRZ-2900 Dtex-Grey 10575-Hs', 3780.0000::numeric, 5.0000::numeric, 'Palette', 756.0000::numeric, 1200::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 1::bigint, 'PES -1500 Deniers-D.Bleu 1271-Gzm', 1568.0000::numeric, 1.4000::numeric, 'Palette', 1120.0000::numeric, 627::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 2::bigint, 'PES -1500 Deniers-Green 1272-Gzm', 224.0000::numeric, 0.2000::numeric, 'Palette', 1120.0000::numeric, 90::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 3::bigint, 'PES -1500 Deniers-Grey 1274-Gzm', 224.0000::numeric, 0.2000::numeric, 'Palette', 1120.0000::numeric, 90::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 4::bigint, 'PES -1500 Deniers-L.Beige 1273-Gzm', 224.0000::numeric, 0.2000::numeric, 'Palette', 1120.0000::numeric, 90::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 5::bigint, 'PES Fdy -1800 Deniers-Gold Cf-101 Turk', 2240.0000::numeric, 2.0000::numeric, 'Palette', 1120.0000::numeric, 896::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 6::bigint, 'PES Fdy -1800 Deniers-White Cf-1001 Turk', 1120.0000::numeric, 1.0000::numeric, 'Palette', 1120.0000::numeric, 448::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 7::bigint, 'PES Fdy-1500 Deniers-Gold Fdy-33005-Gzm', 7000.0000::numeric, 6.2500::numeric, 'Palette', 1120.0000::numeric, 2800::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 8::bigint, 'PES Fdy-1500 Deniers-Taupe Fdy-811100-Gzm', 4480.0000::numeric, 4.0000::numeric, 'Palette', 1120.0000::numeric, 1792::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 9::bigint, 'PES Sh -1200 Deniers-Cream B Cp-1005Turk', 8678.8800::numeric, 12.3000::numeric, 'Palette', 705.6000::numeric, 4133::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 10::bigint, 'PES Sh -1200 Deniers-Cream Cb-1056 Turk', 336.0000::numeric, 0.5000::numeric, 'Palette', 672.0000::numeric, 168::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 11::bigint, 'PES Sh-1200 Deniers-Beige Cp-1432 Sf', 3104.6400::numeric, 4.2000::numeric, 'Palette', 739.2000::numeric, 1411::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 12::bigint, 'PES Sh-1500 Deniers- L.Beige H-2000-Tat', 1223.0400::numeric, 1.3000::numeric, 'Palette', 940.8000::numeric, 582::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 13::bigint, 'PES Sh-1500 Deniers-Beige Cp-2039 Sf', 5174.4000::numeric, 7.0000::numeric, 'Palette', 739.2000::numeric, 2352::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 14::bigint, 'PES Sh-1500 Deniers-Beige H-2001-Tat', 235.2000::numeric, 0.2500::numeric, 'Palette', 940.8000::numeric, 112::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 15::bigint, 'PES Sh-1500 Deniers-Beige Tex-7500 Text', 6295.5200::numeric, 7.3000::numeric, 'Palette', 862.4000::numeric, 2862::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 16::bigint, 'PES Sh-1500 Deniers-Cream H-1008-Tat', 2116.8000::numeric, 2.2500::numeric, 'Palette', 940.8000::numeric, 1008::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 17::bigint, 'PES Sh-1500 Deniers-D.Vizon Cp-2068 Sf', 5174.4000::numeric, 7.0000::numeric, 'Palette', 739.2000::numeric, 2352::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 18::bigint, 'PES Sh-1500 Deniers-D.VizonTex-7521 Text', 5519.3600::numeric, 6.4000::numeric, 'Palette', 862.4000::numeric, 2509::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 19::bigint, 'PES Sh-1500 Deniers-Vizon Cp-2018 Sf', 5174.4000::numeric, 7.0000::numeric, 'Palette', 739.2000::numeric, 2352::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 20::bigint, 'PES Sh-1500 Deniers-VizonTex-7530 Text', 4527.6000::numeric, 5.2500::numeric, 'Palette', 862.4000::numeric, 2058::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 21::bigint, 'PES Ver-1500 Deniers-BleuTex-8100 Text', 1555.2000::numeric, 2.0000::numeric, 'Palette', 777.6000::numeric, 864::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 22::bigint, 'PES Ver-1500 Deniers-TerraTex-8000 Text', 777.6000::numeric, 1.0000::numeric, 'Palette', 777.6000::numeric, 432::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 23::bigint, 'PES-1500 Deniers-Gold Cb-4016 Sf', 168.0000::numeric, 0.2000::numeric, 'Palette', 840.0000::numeric, 67::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 24::bigint, 'PES-3000 Deniers- Dk.Beige Ssl2271-Suj', 196.0000::numeric, 0.2000::numeric, 'Palette', 980.0000::numeric, 78::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 25::bigint, 'PES-3000 Deniers- Dk.Vison Ssl2176-Suj', 1372.0000::numeric, 1.4000::numeric, 'Palette', 980.0000::numeric, 549::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 26::bigint, 'PES-3000 Deniers- Khave Ssl2279-Suj', 245.0000::numeric, 0.2500::numeric, 'Palette', 980.0000::numeric, 98::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 27::bigint, 'PES-3000 Deniers- Pink Ssl2259-Suj', 1323.0000::numeric, 1.3500::numeric, 'Palette', 980.0000::numeric, 529::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 28::bigint, 'PES-3000 Deniers- Rouge Ssl2232-Suj', 196.0000::numeric, 0.2000::numeric, 'Palette', 980.0000::numeric, 78::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 29::bigint, 'PES-3000 Deniers- Seker Cream Ssl2081-Suj', 392.0000::numeric, 0.4000::numeric, 'Palette', 980.0000::numeric, 157::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 30::bigint, 'PES-3000 Deniers- Vison Ssl2247-Suj', 2156.0000::numeric, 2.2000::numeric, 'Palette', 980.0000::numeric, 862::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 31::bigint, 'PES-3000 Deniers- WhiteSsl2331-Suj', 4116.0000::numeric, 4.2000::numeric, 'Palette', 980.0000::numeric, 1646::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 32::bigint, 'PP FRZ-2900 Dtex- Grey 8933-Hs', 264.6000::numeric, 0.3500::numeric, 'Palette', 756.0000::numeric, 84::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 33::bigint, 'PP FRZ-2900 Dtex- Red 7612-Hs', 26346.6000::numeric, 34.8500::numeric, 'Palette', 756.0000::numeric, 8364::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 34::bigint, 'PP FRZ-2900 Dtex-A/Green 8068-Oz', 148.8000::numeric, 0.2000::numeric, 'Palette', 744.0000::numeric, 48::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 35::bigint, 'PP FRZ-2900 Dtex-Beige 2204-Oz', 297.6000::numeric, 0.4000::numeric, 'Palette', 744.0000::numeric, 96::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 36::bigint, 'PP FRZ-2900 Dtex-Beige 44360-Hs', 4876.2000::numeric, 6.4500::numeric, 'Palette', 756.0000::numeric, 1548::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 37::bigint, 'PP FRZ-2900 Dtex-Black 8001-Hs', 3326.4000::numeric, 4.4000::numeric, 'Palette', 756.0000::numeric, 1056::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 38::bigint, 'PP FRZ-2900 Dtex-Black 9000-Oz', 148.8000::numeric, 0.2000::numeric, 'Palette', 744.0000::numeric, 48::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 39::bigint, 'PP FRZ-2900 Dtex-Brown 44361-Hs', 1776.6000::numeric, 2.3500::numeric, 'Palette', 756.0000::numeric, 564::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 40::bigint, 'PP FRZ-2900 Dtex-Brown 6161-Oz', 297.6000::numeric, 0.4000::numeric, 'Palette', 744.0000::numeric, 96::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 41::bigint, 'PP FRZ-2900 Dtex-Camel 44416-Hs', 3931.2000::numeric, 5.2000::numeric, 'Palette', 756.0000::numeric, 1248::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 42::bigint, 'PP FRZ-2900 Dtex-Cream 1104-Tat', 134.4000::numeric, 0.2000::numeric, 'Palette', 672.0000::numeric, 67::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 43::bigint, 'PP FRZ-2900 Dtex-Cream 44412-Hs', 1814.4000::numeric, 2.4000::numeric, 'Palette', 756.0000::numeric, 576::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 44::bigint, 'PP FRZ-2900 Dtex-D.Bleu 6417-Hs', 2268.0000::numeric, 3.0000::numeric, 'Palette', 756.0000::numeric, 720::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 45::bigint, 'PP FRZ-2900 Dtex-D.Green 5463-Hs', 8467.2000::numeric, 11.2000::numeric, 'Palette', 756.0000::numeric, 2688::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 46::bigint, 'PP FRZ-2900 Dtex-Gold 3423-Hs', 3326.4000::numeric, 4.4000::numeric, 'Palette', 756.0000::numeric, 1056::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 47::bigint, 'PP FRZ-2900 Dtex-Grey 10575-Hs', 378.0000::numeric, 0.5000::numeric, 'Palette', 756.0000::numeric, 120::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 48::bigint, 'PP FRZ-2900 Dtex-Navy 7062 -Oz', 148.8000::numeric, 0.2000::numeric, 'Palette', 744.0000::numeric, 48::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 49::bigint, 'PP FRZ-2900 Dtex-Navy Bleu 1697-Tat', 134.4000::numeric, 0.2000::numeric, 'Palette', 672.0000::numeric, 67::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 50::bigint, 'PP FRZ-2900 Dtex-Pink 7639-Hs', 4687.2000::numeric, 6.2000::numeric, 'Palette', 756.0000::numeric, 1488::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 51::bigint, 'PP-1000*2 Dtex-Cream Mn-1201-Tat', 131.5600::numeric, 0.2000::numeric, 'Palette', 657.8000::numeric, 57::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 52::bigint, 'PP-1500 Dtex-Bleu 7201-Oz', 1198.0800::numeric, 1.6000::numeric, 'Palette', 748.8000::numeric, 461::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 53::bigint, 'PP-1500 Dtex-D.Bleu 7200-Oz', 1872.0000::numeric, 2.5000::numeric, 'Palette', 748.8000::numeric, 720::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 54::bigint, 'PP-1500 Dtex-Pink 7623-Hs', 262.0800::numeric, 0.3500::numeric, 'Palette', 748.8000::numeric, 101::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 55::bigint, 'PP-1500 Dtex-Yellow 3151-Oz', 4492.8000::numeric, 6.0000::numeric, 'Palette', 748.8000::numeric, 1728::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 56::bigint, 'PP-1500 Dtex-Yellow 3430-Hs', 299.5200::numeric, 0.4000::numeric, 'Palette', 748.8000::numeric, 115::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 57::bigint, 'PP-1750*2 Dtex-Sh Beige 44414 Hs', 186.0000::numeric, 0.2500::numeric, 'Palette', 744.0000::numeric, 60::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 58::bigint, 'PP-1750*2 Dtex-Sh Brown 44415 Hs', 148.8000::numeric, 0.2000::numeric, 'Palette', 744.0000::numeric, 48::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 59::bigint, 'PP-1750*2 Dtex-Sh Creme 2981 Hs', 1041.6000::numeric, 1.4000::numeric, 'Palette', 744.0000::numeric, 336::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 60::bigint, 'PP-1775*2 Dtex-Cream 1072-Tat', 1545.6000::numeric, 2.3000::numeric, 'Palette', 672.0000::numeric, 773::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 61::bigint, 'PP-1775*2 Dtex-White 1073-Tat', 5611.2000::numeric, 8.3500::numeric, 'Palette', 672.0000::numeric, 2806::bigint, 'THEORIQUE'),
    ('MVT-INIT-SIT-POLY', 62::bigint, 'PP-1900 Dtex-D.Green 5455-Hs', 4687.2000::numeric, 6.3000::numeric, 'Palette', 744.0000::numeric, 1512::bigint, 'THEORIQUE')
       ) AS v(numero_mouvement, ligne_numero, code_reference, quantite_kg,
              quantite_saisie, unite_saisie, facteur_conversion, nb_bobines, mode_pesee)
  JOIN mouvement m ON m.numero_mouvement = v.numero_mouvement
 WHERE NOT EXISTS (SELECT 1 FROM ligne_mouvement l WHERE l.id_mouvement = m.id_mouvement);

DO $$
DECLARE n bigint; kg numeric;
BEGIN
    SELECT count(*), round(sum(quantite_kg)) INTO n, kg FROM stock_magasin WHERE quantite_kg > 0;
    RAISE NOTICE 'stock : % soldes, % kg', n, kg;
END $$;

COMMIT;
