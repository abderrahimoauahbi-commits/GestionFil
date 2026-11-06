/**
 * LES DÉRIVÉS D'UN LOT, sur sa fiche (06/11/2026).
 *
 * Un dérivé n'est pas un nouveau lot : c'est une forme physique DANS le même
 * lot fournisseur — un contenant, un poids d'unité, des unités par palette. Un
 * lot de latex peut arriver en fûts de 600 kg (D1) et de 1000 kg (D2) : même
 * lot, deux dérivés. Chaque lot a son D1 ; tant qu'il n'en a qu'un, rien ne
 * change nulle part.
 *
 * ICI, SUR LA PAGE :
 *   - le stock de chaque dérivé, par magasin ;
 *   - LE RECONDITIONNEMENT (transvaser, défaire une palette, changer de
 *     contenant) : la matière passe d'un dérivé à un autre du même lot, au même
 *     magasin, sans effet sur le coût moyen — le dérivé d'arrivée peut naître ;
 *   - bloquer ou libérer UN dérivé seul (droit VALIDER des lots, motif).
 * Dès qu'un lot a deux dérivés, chaque mouvement doit dire lequel bouge.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Lock, Repeat, Unlock } from 'lucide-react'

import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { Badge, Bouton, Carte, CarteCorps, CarteEntete, CarteTitre, Champ, Etiq, SaisieNombre, Selecteur } from '../../composants/ui/base'
import { lireNombre } from '../../lib/nombres'
import { MODULE_DECISION, messageErreur, nb, useApresDecision, type Lot } from './modele'

/** Un dérivé, tel que `GET /api/lots/derives` le rend. */
interface Derive {
  code_derive: string
  code_conditionnement: string | null
  conditionnement_libelle: string | null
  unite_singulier: string | null
  unite_pluriel: string | null
  poids_unitaire_kg: number | null
  unites_par_palette: number | null
  statut: 'LIBRE' | 'BLOQUE'
  motif_statut: string | null
  quantite_kg: number
  par_magasin: { code_magasin: string; quantite_kg: number }[]
}

interface Conditionnement {
  code_conditionnement: string
  libelle: string
  actif?: number
}

interface Magasin {
  code_magasin: string
  magasin_nom: string | null
}

const NOUVEAU = '__nouveau__'

export function DerivesLot({ lot, magasins }: { lot: Lot; magasins: Magasin[] }) {
  const { peut } = useAuth()
  const peutReconditionner = peut('MOUVEMENTS', 'ECRIRE')
  const peutBloquer = peut(MODULE_DECISION, 'VALIDER')
  const apres = useApresDecision()

  const q = useQuery({
    queryKey: ['lots', 'derives', lot.code_reference, lot.lot_fournisseur],
    queryFn: ({ signal }) =>
      api.get<Derive[]>(
        `/api/lots/derives?code_reference=${encodeURIComponent(lot.code_reference)}&lot_fournisseur=${encodeURIComponent(lot.lot_fournisseur)}`,
        { signal },
      ),
  })
  const qCond = useQuery({
    queryKey: ['conditionnements'],
    queryFn: ({ signal }) => api.get<Conditionnement[]>('/api/conditionnements', { signal }),
    enabled: peutReconditionner,
  })
  const derives = useMemo(() => q.data ?? [], [q.data])
  const plusieurs = derives.length > 1

  // Le reconditionnement, saisi sur la page.
  const [magasin, setMagasin] = useState(magasins.length === 1 ? magasins[0].code_magasin : '')
  const [depuis, setDepuis] = useState('')
  const [vers, setVers] = useState('')
  const [contenant, setContenant] = useState('')
  const [poids, setPoids] = useState('')
  const [parPalette, setParPalette] = useState('')
  const [kg, setKg] = useState('')
  const [motif, setMotif] = useState('')

  const departs = derives.filter((d) => d.par_magasin.some((m) => m.code_magasin === magasin && m.quantite_kg > 0))
  const depuisEff = depuis || (departs.length === 1 ? departs[0].code_derive : '')
  const soldeDepart =
    derives.find((d) => d.code_derive === depuisEff)?.par_magasin.find((m) => m.code_magasin === magasin)?.quantite_kg ?? 0
  const kgLu = kg.trim() ? lireNombre(kg) : null
  const poidsLu = poids.trim() ? lireNombre(poids) : null
  const parPaletteLu = parPalette.trim() ? lireNombre(parPalette) : null
  const manque = !magasin
    ? 'Choisissez le magasin.'
    : !depuisEff
      ? 'Choisissez le dérivé d’où part la matière.'
      : !vers
        ? 'Choisissez le dérivé d’arrivée, ou un nouveau.'
        : vers === NOUVEAU && !poids.trim() && !contenant
          ? 'Décrivez le nouveau dérivé : son contenant ou le poids d’une unité.'
          : poids.trim() && !(poidsLu !== null && poidsLu > 0)
            ? 'Le poids d’une unité est un nombre de kilos positif.'
            : parPalette.trim() && !(parPaletteLu !== null && parPaletteLu > 0 && Number.isInteger(parPaletteLu))
              ? 'Les unités par palette sont un nombre entier positif.'
              : !(kgLu !== null && kgLu > 0)
                ? 'Indiquez les kilos à reconditionner.'
                : kgLu > soldeDepart + 0.0001
                  ? `Le dérivé ${depuisEff} ne porte que ${nb(soldeDepart, 1)} kg dans ce magasin.`
                  : null

  const reconditionner = useMutation({
    mutationFn: () =>
      api.post<{ depuis: string; vers: string; mouvements: string[] }>('/api/lots/derives/reconditionner', {
        code_reference: lot.code_reference,
        lot_fournisseur: lot.lot_fournisseur,
        code_magasin: magasin,
        depuis: depuisEff,
        vers: vers === NOUVEAU ? null : vers,
        nouveau:
          vers === NOUVEAU
            ? {
                code_conditionnement: contenant || null,
                poids_unitaire_kg: poidsLu,
                unites_par_palette: parPaletteLu === null ? null : Math.round(parPaletteLu),
              }
            : null,
        quantite_kg: kgLu,
        motif: motif.trim() || null,
      }),
    onSuccess: async (r) => {
      setVers('')
      setContenant('')
      setPoids('')
      setParPalette('')
      setKg('')
      setMotif('')
      await apres()
      toast.success(`Reconditionné : ${r.depuis} → ${r.vers}`, {
        description: r.mouvements?.length ? `Mouvements ${r.mouvements.join(', ')}` : undefined,
      })
    },
    onError: (e) => toast.error(messageErreur(e)),
  })

  const changerStatut = useMutation({
    mutationFn: (v: { code_derive: string; statut: 'LIBRE' | 'BLOQUE'; motif: string | null }) =>
      api.post('/api/lots/derives/statut', {
        code_reference: lot.code_reference,
        lot_fournisseur: lot.lot_fournisseur,
        ...v,
      }),
    onSuccess: async (_r, v) => {
      await apres()
      toast.success(v.statut === 'BLOQUE' ? `Dérivé ${v.code_derive} bloqué` : `Dérivé ${v.code_derive} libéré`)
    },
    onError: (e) => toast.error(messageErreur(e)),
  })

  // Le blocage se motive SUR LA LIGNE, jamais dans une fenêtre.
  const [aBloquer, setABloquer] = useState('')
  const [motifBlocage, setMotifBlocage] = useState('')

  if (!q.data) return null

  return (
    <Carte repliable="lots.derives" replieParDefaut={!plusieurs}>
      <CarteEntete>
        <CarteTitre>Dérivés du lot{plusieurs ? ` (${derives.length})` : ''}</CarteTitre>
      </CarteEntete>
      <CarteCorps className="flex flex-col gap-3 p-4">
        <p className="text-[12.5px] text-attenue-texte">
          Une forme physique dans le même lot : contenant, poids d’une unité, unités par palette.
          {plusieurs
            ? ' Ce lot en a plusieurs : chaque mouvement dit lequel bouge.'
            : ' Ce lot n’en a qu’un : rien ne change ailleurs tant qu’un second ne naît pas.'}
        </p>

        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-attenue/60 text-[10px] uppercase tracking-wide text-attenue-texte">
              <th className="px-2 py-1 text-left font-medium">Dérivé</th>
              <th className="px-2 py-1 text-left font-medium">Contenant</th>
              <th className="px-2 py-1 text-right font-medium">Poids d’une unité</th>
              <th className="px-2 py-1 text-right font-medium">Unités / palette</th>
              <th className="px-2 py-1 text-right font-medium">Stock</th>
              <th className="px-2 py-1 text-left font-medium">Statut</th>
              {peutBloquer && <th className="px-2 py-1" />}
            </tr>
          </thead>
          <tbody>
            {derives.map((d) => (
              <tr key={d.code_derive} className="border-t border-bordure/60 align-top">
                <td className="px-2 py-1 font-medium">{d.code_derive}</td>
                <td className="px-2 py-1">{d.conditionnement_libelle ?? d.code_conditionnement ?? '—'}</td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {d.poids_unitaire_kg == null ? '—' : `${nb(d.poids_unitaire_kg, 4)} kg`}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">{d.unites_par_palette == null ? '—' : nb(d.unites_par_palette)}</td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {nb(d.quantite_kg, 1)} kg
                  {d.par_magasin.length > 1 &&
                    d.par_magasin.map((m) => (
                      <span key={m.code_magasin} className="block text-[11px] text-attenue-texte">
                        {m.code_magasin} : {nb(m.quantite_kg, 1)} kg
                      </span>
                    ))}
                </td>
                <td className="px-2 py-1">
                  <Badge ton={d.statut === 'BLOQUE' ? 'danger' : 'neutre'}>{d.statut === 'BLOQUE' ? 'Bloqué' : 'Libre'}</Badge>
                  {d.motif_statut && <span className="block text-[11px] text-attenue-texte">{d.motif_statut}</span>}
                </td>
                {peutBloquer && (
                  <td className="px-2 py-1 text-right">
                    {d.statut === 'BLOQUE' ? (
                      <Bouton
                        variante="contour"
                        taille="sm"
                        chargement={changerStatut.isPending}
                        onClick={() => changerStatut.mutate({ code_derive: d.code_derive, statut: 'LIBRE', motif: null })}
                      >
                        <Unlock />
                        Libérer
                      </Bouton>
                    ) : aBloquer === d.code_derive ? (
                      <div className="flex items-center justify-end gap-1">
                        <Champ
                          aria-label={`Motif du blocage de ${d.code_derive}`}
                          className="h-6 w-44 text-[11.5px]"
                          value={motifBlocage}
                          onChange={(e) => setMotifBlocage(e.target.value)}
                          placeholder="Motif du blocage"
                        />
                        <Bouton
                          variante="danger"
                          taille="sm"
                          disabled={!motifBlocage.trim()}
                          chargement={changerStatut.isPending}
                          onClick={() =>
                            changerStatut.mutate(
                              { code_derive: d.code_derive, statut: 'BLOQUE', motif: motifBlocage.trim() },
                              { onSuccess: () => { setABloquer(''); setMotifBlocage('') } },
                            )
                          }
                        >
                          <Lock />
                          Bloquer
                        </Bouton>
                        <Bouton variante="discret" taille="sm" onClick={() => setABloquer('')}>Annuler</Bouton>
                      </div>
                    ) : (
                      <Bouton variante="contour" taille="sm" onClick={() => { setABloquer(d.code_derive); setMotifBlocage('') }}>
                        <Lock />
                        Bloquer
                      </Bouton>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {peutReconditionner && lot.statut === 'LIBRE' && magasins.length > 0 && (
          <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-bordure p-2">
            <div className="text-[12px] font-medium">Reconditionner</div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-44">
                <Etiq htmlFor="dl-mag">Magasin</Etiq>
                <Selecteur id="dl-mag" value={magasin} onChange={(e) => { setMagasin(e.target.value); setDepuis('') }}>
                  <option value="">Choisir…</option>
                  {magasins.map((m) => (
                    <option key={m.code_magasin} value={m.code_magasin}>{m.magasin_nom ?? m.code_magasin}</option>
                  ))}
                </Selecteur>
              </div>
              <div className="w-32">
                <Etiq htmlFor="dl-depuis">Depuis</Etiq>
                <Selecteur id="dl-depuis" value={depuisEff} onChange={(e) => setDepuis(e.target.value)} disabled={!magasin}>
                  <option value="">Choisir…</option>
                  {departs.map((d) => (
                    <option key={d.code_derive} value={d.code_derive}>{d.code_derive}</option>
                  ))}
                </Selecteur>
              </div>
              <div className="w-44">
                <Etiq htmlFor="dl-vers">Vers</Etiq>
                <Selecteur id="dl-vers" value={vers} onChange={(e) => setVers(e.target.value)}>
                  <option value="">Choisir…</option>
                  {derives
                    .filter((d) => d.code_derive !== depuisEff)
                    .map((d) => (
                      <option key={d.code_derive} value={d.code_derive}>{d.code_derive}</option>
                    ))}
                  <option value={NOUVEAU}>Nouveau dérivé…</option>
                </Selecteur>
              </div>
              {vers === NOUVEAU && (
                <>
                  <div className="w-44">
                    <Etiq htmlFor="dl-cont">Contenant</Etiq>
                    <Selecteur id="dl-cont" value={contenant} onChange={(e) => setContenant(e.target.value)}>
                      <option value="">Celui de la fiche article</option>
                      {(qCond.data ?? [])
                        .filter((c) => c.actif !== 0)
                        .map((c) => (
                          <option key={c.code_conditionnement} value={c.code_conditionnement}>{c.libelle}</option>
                        ))}
                    </Selecteur>
                  </div>
                  <div className="w-32">
                    <Etiq htmlFor="dl-poids">Poids d’une unité (kg)</Etiq>
                    <SaisieNombre id="dl-poids" min={0} step={0.001} value={poids} onChange={(e) => setPoids(e.target.value)} />
                  </div>
                  <div className="w-28">
                    <Etiq htmlFor="dl-upp">Unités / palette</Etiq>
                    <SaisieNombre id="dl-upp" min={0} step={1} value={parPalette} onChange={(e) => setParPalette(e.target.value)} />
                  </div>
                </>
              )}
              <div className="w-28">
                <Etiq htmlFor="dl-kg">Kilos</Etiq>
                <SaisieNombre id="dl-kg" min={0} step={0.001} value={kg} onChange={(e) => setKg(e.target.value)} />
              </div>
              <div className="min-w-[12rem] flex-1">
                <Etiq htmlFor="dl-motif">Motif</Etiq>
                <Champ id="dl-motif" value={motif} onChange={(e) => setMotif(e.target.value)}
                       placeholder="Transvasement, palette défaite…" />
              </div>
              <Bouton disabled={!!manque} chargement={reconditionner.isPending} onClick={() => reconditionner.mutate()}
                      title={manque ?? undefined}>
                <Repeat />
                Reconditionner
              </Bouton>
            </div>
            {manque && (kg || vers || poids) && <span className="text-[11px] text-attenue-texte">{manque}</span>}
          </div>
        )}
      </CarteCorps>
    </Carte>
  )
}
