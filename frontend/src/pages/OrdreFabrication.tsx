/**
 * UN ORDRE DE FABRICATION, SUR SA PAGE (22/10/2026).
 *
 *   En-tête   numéro (celui de l'ERP Production, ou OF-AAAA-NNNN tiré par le
 *             serveur), date, fin prévue, qualité, métrage, notes ; modifiable
 *             tant que l'OF est PRÉVU ou LANCÉ. « Enregistrer » n'apparaît
 *             qu'après un changement.
 *   Cycle     PRÉVU → LANCÉ (droit Écrire) → CLÔTURÉ ; ANNULÉ depuis PRÉVU ou
 *             LANCÉ (droit Valider). La base garde les transitions.
 *   Consommation  par référence : le prévu (métrage × recette, perte comprise),
 *             le réel fil (écarts machine attribués à l'OF de la période), le
 *             réel hors machine (sorti − rendu), les déchets, pertes et casses à
 *             part, l'écart réel − prévu.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, Play, Save, XCircle } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { DataTable, type ColonneDT } from '../composants/DataTable'
import { PanneRequetes } from '../composants/PanneRequetes'
import { Alerte, Badge, Bouton, Carte, CarteCorps, CarteEntete, CarteTitre, Champ, Chargement, Etiq, Selecteur, Zone } from '../composants/ui/base'
import { useConfirmation } from '../composants/ui/surcouches'
import { useGardeSaisie } from '../hooks/useGardeSaisie'
import { nouvelIdentifiant } from '../lib/identifiant'
import { fmt } from '../lib/utils'
import { Ecart, LIBELLE_STATUT_OF, MODULE_OF, TON_STATUT_OF, type OfListe } from './OrdresFabrication'

interface EnTeteOf extends OfListe {
  notes: string | null
  version: number
  date_creation: string
  date_cloture: string | null
  kg_autre_ecart: number
  a_recette: boolean
}

interface LigneConso extends Record<string, unknown> {
  code_reference: string
  designation: string
  lots: string | null
  kg_prevu: number
  kg_conso_fil: number
  kg_sorti_hors_machine: number
  kg_rendu_hors_machine: number
  kg_hors_machine: number
  kg_reel: number
  kg_dechet: number
  kg_perte: number
  kg_casse: number
  kg_autre_ecart: number
  ecart_kg: number
  ecart_pct: number | null
}

interface QualiteOf {
  code_qualite: string
  qualite_nom: string
  a_recette: boolean
}

interface Saisie {
  numero: string
  date_of: string
  date_fin_prevue: string
  code_qualite: string
  metrage_m2: string
  notes: string
}

const echec = (e: unknown) => toast.error(e instanceof ErreurApi ? e.message : 'Opération impossible.')
const kg = (v: unknown) => fmt.nombre(Number(v ?? 0), 1)
const jourIso = (v: string | null | undefined) => (v ? v.slice(0, 10) : '')

export function OrdreFabrication() {
  const { id = 'nouveau' } = useParams()
  if (id === 'nouveau') return <NouvelOf />
  return <DocumentOf key={id} id={id} />
}

function useQualites() {
  return useQuery({
    queryKey: ['of-qualites'],
    queryFn: ({ signal }) => api.get<QualiteOf[]>('/api/ordres-fabrication/qualites', { signal }),
  })
}

/** Les champs de l'en-tête, communs à la création et à la modification. */
function ChampsEnTete({
  saisie,
  definir,
  modifiable,
  qualites,
  creation,
}: {
  saisie: Saisie
  definir: (s: Partial<Saisie>) => void
  modifiable: boolean
  qualites: QualiteOf[]
  creation?: boolean
}) {
  const choisie = qualites.find((q) => q.code_qualite === saisie.code_qualite)
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <Etiq htmlFor="of-numero">N° d’OF</Etiq>
        <Champ
          id="of-numero"
          value={saisie.numero}
          disabled={!modifiable}
          placeholder={creation ? 'Vide : OF-AAAA-NNNN' : undefined}
          onChange={(e) => definir({ numero: e.target.value })}
        />
      </div>
      <div>
        <Etiq htmlFor="of-date" obligatoire>Date</Etiq>
        <Champ id="of-date" type="date" value={saisie.date_of} disabled={!modifiable}
          onChange={(e) => definir({ date_of: e.target.value })} />
      </div>
      <div>
        <Etiq htmlFor="of-fin">Fin prévue</Etiq>
        <Champ id="of-fin" type="date" value={saisie.date_fin_prevue} disabled={!modifiable}
          onChange={(e) => definir({ date_fin_prevue: e.target.value })} />
      </div>
      <div>
        <Etiq htmlFor="of-qualite" obligatoire>Qualité</Etiq>
        <Selecteur id="of-qualite" value={saisie.code_qualite} disabled={!modifiable}
          onChange={(e) => definir({ code_qualite: e.target.value })}>
          <option value="">Choisir…</option>
          {qualites.map((q) => (
            <option key={q.code_qualite} value={q.code_qualite}>
              {q.code_qualite} — {q.qualite_nom}
            </option>
          ))}
        </Selecteur>
        {choisie && !choisie.a_recette && (
          <p className="mt-1 text-[11px] text-alerte">Pas de recette active : le prévu ne se calculera pas.</p>
        )}
      </div>
      <div>
        <Etiq htmlFor="of-metrage" obligatoire>Métrage (m²)</Etiq>
        <Champ id="of-metrage" type="number" min={0} value={saisie.metrage_m2} disabled={!modifiable}
          onChange={(e) => definir({ metrage_m2: e.target.value })} />
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <Etiq htmlFor="of-notes">Notes</Etiq>
        <Zone id="of-notes" value={saisie.notes} disabled={!modifiable}
          onChange={(e) => definir({ notes: e.target.value })} />
      </div>
    </div>
  )
}

function valider(s: Saisie): string | null {
  if (!s.code_qualite) return 'Choisissez la qualité.'
  if (!s.date_of) return 'La date de l’OF est obligatoire.'
  const m = Number(s.metrage_m2)
  if (!s.metrage_m2 || !Number.isFinite(m) || m <= 0) return 'Le métrage doit être positif.'
  if (s.date_fin_prevue && s.date_fin_prevue < s.date_of) return 'La fin prévue précède la date de l’OF.'
  return null
}

// ============================================================================
// Création
// ============================================================================

function NouvelOf() {
  const droits = useDroits(MODULE_OF)
  const naviguer = useNavigate()
  const qc = useQueryClient()
  const qQualites = useQualites()
  const [idDocument] = useState(nouvelIdentifiant)
  const [saisie, setSaisie] = useState<Saisie>({
    numero: '',
    date_of: new Date().toLocaleDateString('sv-SE'),
    date_fin_prevue: '',
    code_qualite: '',
    metrage_m2: '',
    notes: '',
  })
  const touche = saisie.numero !== '' || saisie.code_qualite !== '' || saisie.metrage_m2 !== '' || saisie.notes !== ''
  const quitter = useGardeSaisie(touche)
  const erreur = valider(saisie)

  const creer = useMutation({
    mutationFn: () =>
      api.post<{ id_of: string; numero: string }>('/api/ordres-fabrication', {
        id_document: idDocument,
        numero: saisie.numero.trim() || null,
        date_of: saisie.date_of,
        date_fin_prevue: saisie.date_fin_prevue || null,
        code_qualite: saisie.code_qualite,
        metrage_m2: Number(saisie.metrage_m2),
        notes: saisie.notes.trim() || null,
      }),
    onSuccess: (r) => {
      toast.success(`Ordre de fabrication ${r.numero} créé.`)
      void qc.invalidateQueries({ queryKey: ['ordres-fabrication'] })
      naviguer(`/ordres-fabrication/${r.id_of}`, { replace: true })
    },
    onError: echec,
  })

  return (
    <div>
      <EnTetePage
        titre="Nouvel ordre de fabrication"
        description="Il naît PRÉVU : il compte dans le besoin, il ne touche pas le stock."
        actions={
          <div className="flex gap-2">
            <Bouton variante="contour" onClick={() => quitter(() => naviguer('/ordres-fabrication'))}>
              <ArrowLeft />
              Retour
            </Bouton>
            {droits.peutEcrire && (
              <Bouton disabled={!!erreur || creer.isPending} title={erreur ?? undefined} onClick={() => creer.mutate()}>
                <Save />
                Créer
              </Bouton>
            )}
          </div>
        }
      />
      <PanneRequetes requetes={[['Les qualités', qQualites]]} />
      <Carte>
        <CarteCorps className="pt-4">
          <ChampsEnTete
            saisie={saisie}
            definir={(s) => setSaisie((x) => ({ ...x, ...s }))}
            modifiable={droits.peutEcrire}
            qualites={qQualites.data ?? []}
            creation
          />
        </CarteCorps>
      </Carte>
    </div>
  )
}

// ============================================================================
// Le document
// ============================================================================

function versSaisie(o: EnTeteOf): Saisie {
  return {
    numero: o.numero,
    date_of: jourIso(o.date_of),
    date_fin_prevue: jourIso(o.date_fin_prevue),
    code_qualite: o.code_qualite,
    metrage_m2: String(o.metrage_m2),
    notes: o.notes ?? '',
  }
}

function DocumentOf({ id }: { id: string }) {
  const droits = useDroits(MODULE_OF)
  const naviguer = useNavigate()
  const qc = useQueryClient()
  const confirmation = useConfirmation()
  const qQualites = useQualites()
  const qOf = useQuery({
    queryKey: ['ordre-fabrication', id],
    queryFn: ({ signal }) => api.get<EnTeteOf>(`/api/ordres-fabrication/${id}`, { signal }),
  })
  const qConso = useQuery({
    queryKey: ['ordre-fabrication-conso', id],
    queryFn: ({ signal }) => api.get<LigneConso[]>(`/api/ordres-fabrication/${id}/consommation`, { signal }),
  })
  const of = qOf.data
  const [brouillon, setBrouillon] = useState<Saisie | null>(null)
  const serveur = useMemo(() => (of ? versSaisie(of) : null), [of])
  const saisie = brouillon ?? serveur
  const modifie = !!brouillon && !!serveur && JSON.stringify(brouillon) !== JSON.stringify(serveur)
  const quitter = useGardeSaisie(modifie)

  const ouvert = of?.statut === 'PREVU' || of?.statut === 'LANCE'
  const modifiable = ouvert && droits.peutEcrire

  const rafraichir = () => {
    void qc.invalidateQueries({ queryKey: ['ordres-fabrication'] })
    void qc.invalidateQueries({ queryKey: ['ordre-fabrication', id] })
    void qc.invalidateQueries({ queryKey: ['ordre-fabrication-conso', id] })
    void qc.invalidateQueries({ queryKey: ['consommation-qualites'] })
  }

  const enregistrer = useMutation({
    mutationFn: () => {
      const s = brouillon!
      return api.patch(`/api/ordres-fabrication/${id}`, {
        version: of!.version,
        numero: s.numero.trim() || undefined,
        date_of: s.date_of,
        date_fin_prevue: s.date_fin_prevue,
        code_qualite: s.code_qualite,
        metrage_m2: Number(s.metrage_m2),
        notes: s.notes,
      })
    },
    onSuccess: () => {
      toast.success('Ordre de fabrication enregistré.')
      setBrouillon(null)
      rafraichir()
    },
    onError: echec,
  })

  const cycle = useMutation({
    mutationFn: (statut: string) => api.put(`/api/ordres-fabrication/${id}/statut`, { statut, version: of!.version }),
    onSuccess: (_r, statut) => {
      toast.success(`Ordre de fabrication ${LIBELLE_STATUT_OF[statut]?.toLowerCase() ?? statut}.`)
      rafraichir()
    },
    onError: echec,
  })

  const colonnes: ColonneDT<LigneConso>[] = [
    {
      champ: 'code_reference',
      entete: 'Référence',
      rendu: (l) => (
        <span title={l.designation}>
          <span className="font-mono text-xs">{l.code_reference}</span>
        </span>
      ),
    },
    { champ: 'kg_prevu', entete: 'Prévu (kg)', numerique: true, rendu: (l) => kg(l.kg_prevu) },
    { champ: 'kg_conso_fil', entete: 'Réel fil (kg)', numerique: true, rendu: (l) => kg(l.kg_conso_fil) },
    {
      champ: 'kg_hors_machine',
      entete: 'Réel hors machine (kg)',
      numerique: true,
      rendu: (l) => (
        <span title={`Sorti ${kg(l.kg_sorti_hors_machine)} − rendu ${kg(l.kg_rendu_hors_machine)}`}>{kg(l.kg_hors_machine)}</span>
      ),
    },
    { champ: 'kg_reel', entete: 'Réel (kg)', numerique: true, rendu: (l) => <strong className="tabular-nums">{kg(l.kg_reel)}</strong> },
    {
      champ: 'ecart_kg',
      entete: 'Écart (kg)',
      numerique: true,
      rendu: (l) => <Ecart kg={Number(l.ecart_kg)} pct={l.ecart_pct == null ? null : Number(l.ecart_pct)} />,
    },
    {
      champ: 'kg_dechet',
      entete: 'Déchets · pertes · casses (kg)',
      secondaire: true,
      rendu: (l) => `${kg(l.kg_dechet)} · ${kg(l.kg_perte)} · ${kg(l.kg_casse)}`,
    },
    { champ: 'kg_autre_ecart', entete: 'Autres écarts (kg)', secondaire: true, rendu: (l) => kg(l.kg_autre_ecart) },
    { champ: 'lots', entete: 'Lots', secondaire: true, rendu: (l) => l.lots ?? '—' },
  ]

  if (qOf.isLoading) return <Chargement />
  if (!of || !saisie) {
    return (
      <div>
        <PanneRequetes requetes={[['L’ordre de fabrication', qOf]]} />
        <Bouton variante="contour" onClick={() => naviguer('/ordres-fabrication')}>
          <ArrowLeft />
          Retour
        </Bouton>
      </div>
    )
  }
  const erreur = modifie ? valider(saisie) : null
  const dpc = Number(of.kg_dechet) + Number(of.kg_perte) + Number(of.kg_casse)

  return (
    <div>
      <EnTetePage
        titre={`OF ${of.numero}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge ton={TON_STATUT_OF[of.statut] ?? 'neutre'}>{LIBELLE_STATUT_OF[of.statut] ?? of.statut}</Badge>
            <span>
              {of.code_qualite} — {of.qualite_nom} · {fmt.nombre(Number(of.metrage_m2), 0)} m²
            </span>
          </span>
        }
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            <Bouton variante="contour" onClick={() => quitter(() => naviguer('/ordres-fabrication'))}>
              <ArrowLeft />
              Retour
            </Bouton>
            {modifie && modifiable && (
              <Bouton disabled={!!erreur || enregistrer.isPending} title={erreur ?? undefined} onClick={() => enregistrer.mutate()}>
                <Save />
                Enregistrer
              </Bouton>
            )}
            {!modifie && of.statut === 'PREVU' && droits.peutEcrire && (
              <Bouton disabled={cycle.isPending} onClick={() => cycle.mutate('LANCE')}>
                <Play />
                Lancer
              </Bouton>
            )}
            {!modifie && of.statut === 'LANCE' && droits.peutValider && (
              <Bouton
                disabled={cycle.isPending}
                onClick={() =>
                  confirmation.demander({
                    titre: `Clôturer l’OF ${of.numero} ?`,
                    description: 'La consommation de l’OF est arrêtée et son en-tête figé. Il ne compte plus dans le besoin.',
                    libelleConfirmer: 'Clôturer',
                    action: () => cycle.mutate('CLOTURE'),
                  })
                }
              >
                <CheckCircle2 />
                Clôturer
              </Bouton>
            )}
            {!modifie && ouvert && droits.peutValider && (
              <Bouton
                variante="contour"
                disabled={cycle.isPending}
                onClick={() =>
                  confirmation.demander({
                    titre: `Annuler l’OF ${of.numero} ?`,
                    description: 'L’OF sort du besoin et des statistiques par qualité. Ce qui a été consommé reste dans les mouvements et les constats.',
                    libelleConfirmer: 'Annuler l’OF',
                    destructif: true,
                    action: () => cycle.mutate('ANNULE'),
                  })
                }
              >
                <XCircle />
                Annuler l’OF
              </Bouton>
            )}
          </div>
        }
      />
      {confirmation.element}
      <PanneRequetes requetes={[['L’ordre de fabrication', qOf], ['La consommation', qConso]]} />

      <div className="space-y-4">
        <Carte>
          <CarteEntete>
            <CarteTitre>En-tête</CarteTitre>
          </CarteEntete>
          <CarteCorps>
            <ChampsEnTete
              saisie={saisie}
              definir={(s) => setBrouillon({ ...saisie, ...s })}
              modifiable={modifiable}
              qualites={qQualites.data ?? []}
            />
            <p className="mt-3 text-xs text-attenue-texte">
              Créé le {fmt.dateHeure(of.date_creation)}
              {of.cree_par ? ` par ${of.cree_par}` : ''}
              {of.date_cloture ? ` · clôturé le ${fmt.dateHeure(of.date_cloture)}` : ''}
            </p>
          </CarteCorps>
        </Carte>

        <Carte>
          <CarteEntete>
            <CarteTitre>Consommation : prévu et réel</CarteTitre>
          </CarteEntete>
          <CarteCorps className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Chiffre libelle="Prévu" valeur={`${kg(of.kg_prevu)} kg`} />
              <Chiffre libelle="Réel" valeur={`${kg(of.kg_reel)} kg`} detail={`fil ${kg(of.kg_conso_fil)} · hors machine ${kg(of.kg_hors_machine)}`} />
              <Chiffre libelle="Écart réel − prévu" valeur={<Ecart kg={Number(of.ecart_kg)} pct={of.ecart_pct == null ? null : Number(of.ecart_pct)} />} />
              <Chiffre libelle="Déchets · pertes · casses" valeur={`${kg(dpc)} kg`} detail={Number(of.kg_autre_ecart) ? `autres écarts ${kg(of.kg_autre_ecart)} kg` : undefined} />
            </div>
            {!of.a_recette && (
              <Alerte ton="alerte">La qualité {of.code_qualite} n’a pas de recette active : le prévu n’est pas calculé.</Alerte>
            )}
            <p className="text-xs text-attenue-texte">
              Réel fil : écarts à effet consommation des constats machine dont la période appartenait à cet OF (corrections
              exclues). Hors machine : consommations directes portant l’OF, retours au magasin déduits. Le prévu (métrage ×
              recette, perte comprise) n’est qu’un étalon.
            </p>
            <DataTable<LigneConso>
              exportable={`of-${of.numero}-consommation`}
              imprimable={`OF ${of.numero} — consommation`}
              module={MODULE_OF}
              colonnes={colonnes}
              lignes={qConso.data ?? []}
              cle={(l) => l.code_reference}
              titreCarte={(l) => l.code_reference}
              placeholderRecherche="Filtrer les références..."
              tailleParDefaut={50}
              videTitre="Ni prévu ni consommation"
            />
          </CarteCorps>
        </Carte>
      </div>
    </div>
  )
}

function Chiffre({ libelle, valeur, detail }: { libelle: string; valeur: React.ReactNode; detail?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-attenue-texte">{libelle}</div>
      <div className="font-medium tabular-nums">{valeur}</div>
      {detail && <div className="truncate text-[11px] text-attenue-texte">{detail}</div>}
    </div>
  )
}
