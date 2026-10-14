/**
 * PeseesMobile — la pesee d'une reception AU DOIGT, sous 768 px.
 *
 * POURQUOI UN ECRAN A PART. Au bureau, la pesee se tape dans une grille large
 * (`GrilleLignes`) : une ligne, dix colonnes, le ✓ a droite. Sur un telephone de
 * quai cette grille deborde — c'est tout le probleme qu'on repare. Ici, chaque
 * ligne est une CARTE (ce qui identifie et ce qui se pese en tete, le reste en
 * ligne « ↳ »), et la saisie d'une ligne s'ouvre en FEUILLE PLEIN ECRAN, jamais
 * en fenetre surgissante — on pese un article a la fois, au pouce.
 *
 * MEME ETAT QUE LA GRILLE : on recoit `lignes` / `setLignes` du document et on
 * ecrit dedans les memes `LigneSaisie`. Rien ne part au serveur ici ; c'est le
 * bouton « Enregistrer » du document qui envoie l'en-tete et les lignes
 * ensemble. Valider une ligne la fige a l'ecran (`valide`), comme la grille.
 *
 * MAGASINIER = QUANTITES SEULES : aucun prix, aucune valeur. Le poids est en
 * kilos ; l'ecart affiche est le DELTA FACTUEL en kilos face a l'attendu, pas un
 * pourcentage — l'ecart officiel, calcule par le serveur, parait apres controle.
 */
import { useMemo, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { ArrowLeft, Check, Package, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import {
  type LigneSaisie,
  type RefLigne,
  depuisReference,
  estPrete,
  kgDe,
} from '../../composants/GrilleLignes'
import { Badge, Bouton, Champ, Etiq, Selecteur } from '../../composants/ui/base'
import { cn, fmt } from '../../lib/utils'

interface Magasin {
  code_magasin: string
  nom: string
  est_quarantaine: number
}

export interface PeseesMobileProps {
  lignes: LigneSaisie[]
  setLignes: Dispatch<SetStateAction<LigneSaisie[]>>
  /** Ce que le bon de commande attend encore chez ce fournisseur. */
  proposees: RefLigne[]
  /** Chercher une reference hors des lignes attendues (livraison hors commande). */
  chercherCatalogue: (motif: string) => Promise<RefLigne[]>
  magasins: Magasin[]
  /** Un excedent au-dela exige une derogation (tolerance du fournisseur). */
  tolerancePct: number
  /** La derogation ne se coche qu'en brouillon. */
  brouillon: boolean
  surRetirer: (l: LigneSaisie) => void
}

const QUALITES: { valeur: string; libelle: string }[] = [
  { valeur: 'CONFORME', libelle: 'Conforme' },
  { valeur: 'QUARANTAINE', libelle: 'Quarantaine' },
  { valeur: 'NON_CONFORME', libelle: 'Non conforme' },
]

/** Le depassement de l'attendu, en kilos et en %, ou null si pas comparable. */
function ecartVsAttendu(l: LigneSaisie): { kg: number; pct: number } | null {
  const kg = kgDe(l)
  const attendu = l.suggere_kg
  if (kg == null || attendu == null || attendu <= 0) return null
  return { kg: kg - attendu, pct: ((kg - attendu) / attendu) * 100 }
}

export function PeseesMobile({
  lignes,
  setLignes,
  proposees,
  chercherCatalogue,
  magasins,
  tolerancePct,
  brouillon,
  surRetirer,
}: PeseesMobileProps) {
  /* La ligne en cours d'edition est une COPIE : on ne touche aux lignes du
     document qu'a « Valider la ligne ». Fermer sans valider ne change rien. */
  const [edite, setEdite] = useState<LigneSaisie | null>(null)
  const [estNouvelle, setEstNouvelle] = useState(false)
  const [ajout, setAjout] = useState(false)

  const ouvrir = (l: LigneSaisie) => {
    setEdite({ ...l, extra: { ...l.extra } })
    setEstNouvelle(false)
  }
  const ouvrirNouvelle = (ref: RefLigne) => {
    const nl = depuisReference(ref)
    // Le magasin par defaut : le premier hors quarantaine, pour ne pas poser le
    // stock en zone bloquee sans le vouloir.
    const parDefaut = magasins.find((m) => m.est_quarantaine !== 1)?.code_magasin ?? ''
    setEdite({ ...nl, extra: { ...nl.extra, magasin: parDefaut, qualite: 'CONFORME' } })
    setEstNouvelle(true)
    setAjout(false)
  }
  const fermer = () => {
    setEdite(null)
    setEstNouvelle(false)
  }

  const valider = () => {
    if (!edite) return
    const fige: LigneSaisie = { ...edite, valide: true }
    setLignes((ls) =>
      estNouvelle ? [...ls, fige] : ls.map((x) => (x.cle === fige.cle ? fige : x)),
    )
    fermer()
  }

  const retirer = () => {
    if (edite && !estNouvelle) surRetirer(edite)
    fermer()
  }

  const poser = (patch: Partial<LigneSaisie>) => setEdite((e) => (e ? { ...e, ...patch } : e))
  const poserExtra = (cle: string, v: string) =>
    setEdite((e) => (e ? { ...e, extra: { ...e.extra, [cle]: v } } : e))

  return (
    <div className="px-3 py-3">
      {lignes.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-bordure px-4 py-10 text-center">
          <Package className="mx-auto mb-2 size-6 text-attenue-texte" />
          <p className="text-[14px] font-medium">Aucune ligne pesée</p>
          <p className="mt-0.5 text-[12.5px] text-attenue-texte">
            Ajoutez ce que le camion a livré, article par article.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {lignes.map((l) => (
            <CarteLigne key={l.cle} ligne={l} tolerancePct={tolerancePct} surOuvrir={() => ouvrir(l)} />
          ))}
        </ul>
      )}

      <Bouton variante="contour" className="mt-3 w-full" onClick={() => setAjout(true)}>
        <Plus />
        Ajouter une ligne pesée
      </Bouton>

      {ajout && (
        <FeuilleAjout
          proposees={proposees}
          chercherCatalogue={chercherCatalogue}
          dejaSaisies={lignes.map((l) => l.code_reference)}
          surChoix={ouvrirNouvelle}
          surFermer={() => setAjout(false)}
        />
      )}

      {edite && (
        <FeuilleEdition
          ligne={edite}
          magasins={magasins}
          tolerancePct={tolerancePct}
          brouillon={brouillon}
          estNouvelle={estNouvelle}
          poser={poser}
          poserExtra={poserExtra}
          surValider={valider}
          surRetirer={retirer}
          surFermer={fermer}
        />
      )}
    </div>
  )
}

/** Une ligne pesée, en carte : identité + poids en tête, le reste en « ↳ ». */
function CarteLigne({
  ligne,
  tolerancePct,
  surOuvrir,
}: {
  ligne: LigneSaisie
  tolerancePct: number
  surOuvrir: () => void
}) {
  const kg = kgDe(ligne)
  const e = ligne.extra ?? {}
  const ecart = ecartVsAttendu(ligne)
  const hors = ecart != null && ecart.pct > tolerancePct
  const prete = estPrete(ligne, true)
  const secondaires = [
    e.lot ? `Lot ${e.lot}` : 'Lot —',
    e.magasin ? `Magasin ${e.magasin}` : null,
    e.colis ? `${e.colis} colis` : null,
  ].filter(Boolean) as string[]

  return (
    <li>
      <button
        type="button"
        onClick={surOuvrir}
        className={cn(
          'flex w-full items-start gap-3 rounded-[var(--radius)] border bg-surface px-3 py-2.5 text-left transition-colors hover:bg-attenue/40',
          hors ? 'border-danger/50' : 'border-bordure',
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{ligne.code_reference || '—'}</span>
            {ligne.valide ? (
              <Badge ton="succes">validée</Badge>
            ) : prete ? (
              <Badge ton="info">à valider</Badge>
            ) : (
              <Badge ton="alerte">à peser</Badge>
            )}
          </div>
          {ligne.intitule && ligne.intitule !== ligne.code_reference && (
            <div className="truncate text-[12px] text-attenue-texte">{ligne.intitule}</div>
          )}

          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-[15px] font-semibold tabular-nums">
              {kg == null ? '— kg' : `${fmt.nombre(kg, 2)} kg`}
            </span>
            {ligne.suggere_kg != null && (
              <span className="text-[12px] text-attenue-texte tabular-nums">
                attendu {fmt.nombre(ligne.suggere_kg, 0)} kg
              </span>
            )}
            {ecart != null && Math.abs(ecart.kg) > 0.001 && (
              <span className={cn('text-[12px] tabular-nums', hors ? 'font-medium text-danger' : 'text-attenue-texte')}>
                {ecart.kg > 0 ? '+' : ''}
                {fmt.nombre(ecart.kg, 1)} kg
                {hors ? ' · hors tolérance' : ''}
              </span>
            )}
          </div>

          <div className="mt-1 space-y-0.5 text-[12px] text-attenue-texte">
            {secondaires.length > 0 && <div className="truncate">↳ {secondaires.join(' · ')}</div>}
            <div className="flex items-center gap-1.5">
              <span className="shrink-0">↳</span>
              <Badge
                ton={
                  e.qualite === 'NON_CONFORME'
                    ? 'danger'
                    : e.qualite === 'QUARANTAINE'
                      ? 'alerte'
                      : 'succes'
                }
              >
                {QUALITES.find((q) => q.valeur === (e.qualite ?? 'CONFORME'))?.libelle}
              </Badge>
            </div>
          </div>
        </div>
        <Pencil className="mt-0.5 size-4 shrink-0 text-attenue-texte" />
      </button>
    </li>
  )
}

/**
 * La feuille plein ecran : un en-tete qui reprend au document, un corps qui
 * defile, un pied d'actions qui ne bouge pas. Sert a editer une ligne comme a
 * en ajouter une.
 */
function FeuilleMobile({
  titre,
  sousTitre,
  surFermer,
  pied,
  children,
}: {
  titre: string
  sousTitre?: string
  surFermer: () => void
  pied?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-fond">
      <header className="flex shrink-0 items-center gap-2 border-b border-bordure bg-surface px-3 py-2.5">
        <button
          type="button"
          onClick={surFermer}
          aria-label="Retour"
          className="grid size-9 place-items-center rounded-[var(--radius-sm)] text-attenue-texte transition-colors hover:bg-attenue hover:text-texte"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold leading-tight">{titre}</div>
          {sousTitre && <div className="truncate text-[12px] text-attenue-texte">{sousTitre}</div>}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{children}</div>
      {pied && (
        <footer
          className="flex shrink-0 items-center gap-2 border-t border-bordure bg-surface px-3 py-2.5"
          style={{ paddingBottom: 'calc(0.625rem + var(--marge-sure-bas))' }}
        >
          {pied}
        </footer>
      )}
    </div>
  )
}

/** Peser une ligne : poids en grand, puis lot / colis / magasin / qualité. */
function FeuilleEdition({
  ligne,
  magasins,
  tolerancePct,
  brouillon,
  estNouvelle,
  poser,
  poserExtra,
  surValider,
  surRetirer,
  surFermer,
}: {
  ligne: LigneSaisie
  magasins: Magasin[]
  tolerancePct: number
  brouillon: boolean
  estNouvelle: boolean
  poser: (patch: Partial<LigneSaisie>) => void
  poserExtra: (cle: string, v: string) => void
  surValider: () => void
  surRetirer: () => void
  surFermer: () => void
}) {
  const e = ligne.extra ?? {}
  const ecart = ecartVsAttendu(ligne)
  const hors = ecart != null && ecart.pct > tolerancePct
  const prete = estPrete(ligne, true)
  const derog = e.derog === '1'

  return (
    <FeuilleMobile
      titre={`Peser — ${ligne.code_reference || 'nouvelle ligne'}`}
      sousTitre={
        ligne.suggere_kg != null
          ? `${ligne.intitule} · attendu ${fmt.nombre(ligne.suggere_kg, 0)} kg`
          : ligne.intitule || undefined
      }
      surFermer={surFermer}
      pied={
        <>
          <Bouton
            variante="contour"
            className="text-danger hover:bg-danger/10"
            onClick={surRetirer}
          >
            <Trash2 />
            {estNouvelle ? 'Abandonner' : 'Retirer'}
          </Bouton>
          <Bouton className="ml-auto" disabled={!prete} onClick={surValider}>
            <Check />
            Valider la ligne
          </Bouton>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Etiq htmlFor="pm-kg" obligatoire>
            Poids pesé (kg)
          </Etiq>
          <Champ
            id="pm-kg"
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            autoFocus
            value={ligne.qte}
            onChange={(ev) => poser({ qte: ev.target.value })}
            className="h-14 text-right text-[22px] font-semibold tabular-nums"
            aria-label="Poids pesé en kilos"
          />
          {ecart != null && Math.abs(ecart.kg) > 0.001 && (
            <p className={cn('mt-1 text-[12.5px]', hors ? 'font-medium text-danger' : 'text-attenue-texte')}>
              {ecart.kg > 0 ? '+' : ''}
              {fmt.nombre(ecart.kg, 1)} kg face à l’attendu
              {hors ? ` — au-delà de la tolérance de ${tolerancePct} %, une dérogation est requise.` : '.'}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Etiq htmlFor="pm-lot">Lot fournisseur</Etiq>
            <Champ
              id="pm-lot"
              value={e.lot ?? ''}
              onChange={(ev) => poserExtra('lot', ev.target.value)}
              aria-label="Lot du fournisseur"
            />
          </div>
          <div>
            <Etiq htmlFor="pm-mag">Magasin</Etiq>
            <Selecteur
              id="pm-mag"
              value={e.magasin ?? ''}
              onChange={(ev) => poserExtra('magasin', ev.target.value)}
              aria-label="Magasin de destination"
            >
              <option value="">—</option>
              {magasins.map((m) => (
                <option key={m.code_magasin} value={m.code_magasin}>
                  {m.nom}
                </option>
              ))}
            </Selecteur>
          </div>
          <div>
            <Etiq htmlFor="pm-colis">Colis (BL)</Etiq>
            <Champ
              id="pm-colis"
              type="number"
              min="0"
              inputMode="numeric"
              value={e.colis ?? ''}
              onChange={(ev) => poserExtra('colis', ev.target.value)}
              className="text-right tabular-nums"
              aria-label="Nombre de colis annoncé au bon de livraison"
            />
          </div>
          <div>
            <Etiq htmlFor="pm-bl">Annoncé au BL (kg)</Etiq>
            <Champ
              id="pm-bl"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              value={e.bl ?? ''}
              onChange={(ev) => poserExtra('bl', ev.target.value)}
              className="text-right tabular-nums"
              aria-label="Quantité annoncée au bon de livraison, en kilos"
            />
          </div>
        </div>

        <div>
          <Etiq htmlFor="pm-qualite">Qualité</Etiq>
          <Selecteur
            id="pm-qualite"
            value={e.qualite ?? 'CONFORME'}
            onChange={(ev) => poserExtra('qualite', ev.target.value)}
            aria-label="Statut qualité de la ligne"
          >
            {QUALITES.map((q) => (
              <option key={q.valeur} value={q.valeur}>
                {q.libelle}
              </option>
            ))}
          </Selecteur>
        </div>

        {hors && (
          <label className="flex items-start gap-2 rounded-[var(--radius)] border border-danger/40 bg-danger/5 px-3 py-2 text-[13px]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={derog}
              disabled={!brouillon}
              onChange={(ev) => poserExtra('derog', ev.target.checked ? '1' : '')}
              aria-label="Dérogation à l’écart de pesée"
            />
            <span className="min-w-0 flex-1">
              <span className="font-medium">Dérogation à l’excédent</span>
              {derog && (
                <Champ
                  value={e.motif_derog ?? ''}
                  onChange={(ev) => poserExtra('motif_derog', ev.target.value)}
                  placeholder="Motif de la dérogation"
                  className="mt-1.5 h-9"
                  disabled={!brouillon}
                  aria-label="Motif de la dérogation"
                />
              )}
            </span>
          </label>
        )}
      </div>
    </FeuilleMobile>
  )
}

/** Choisir la référence à peser : d’abord ce qui est attendu, sinon le catalogue. */
function FeuilleAjout({
  proposees,
  chercherCatalogue,
  dejaSaisies,
  surChoix,
  surFermer,
}: {
  proposees: RefLigne[]
  chercherCatalogue: (motif: string) => Promise<RefLigne[]>
  dejaSaisies: string[]
  surChoix: (ref: RefLigne) => void
  surFermer: () => void
}) {
  const [motif, setMotif] = useState('')
  const [catalogue, setCatalogue] = useState<RefLigne[]>([])
  const [cherche, setCherche] = useState(false)

  const motifNettoye = motif.trim().toLowerCase()
  const attendues = useMemo(
    () =>
      proposees.filter(
        (r) =>
          !motifNettoye ||
          r.code_reference.toLowerCase().includes(motifNettoye) ||
          (r.designation ?? '').toLowerCase().includes(motifNettoye),
      ),
    [proposees, motifNettoye],
  )

  const chercher = async () => {
    if (motifNettoye.length < 2) return
    setCherche(true)
    try {
      setCatalogue(await chercherCatalogue(motif.trim()))
    } finally {
      setCherche(false)
    }
  }

  const codesAttendus = new Set(proposees.map((r) => r.code_reference))
  const horsAttendu = catalogue.filter((r) => !codesAttendus.has(r.code_reference))

  return (
    <FeuilleMobile titre="Ajouter une ligne" sousTitre="Ce que le camion a livré" surFermer={surFermer}>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-attenue-texte" />
        <Champ
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void chercher()
          }}
          placeholder="Référence ou désignation…"
          className="pl-8"
          aria-label="Chercher une référence"
        />
      </div>

      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-attenue-texte">
        Attendu chez ce fournisseur
      </p>
      {attendues.length === 0 ? (
        <p className="px-1 py-2 text-[13px] text-attenue-texte">Rien d’attendu ne correspond.</p>
      ) : (
        <ul className="space-y-1.5">
          {attendues.map((r) => (
            <PropositionRef
              key={r.code_reference}
              ref_={r}
              deja={dejaSaisies.includes(r.code_reference)}
              surChoix={() => surChoix(r)}
            />
          ))}
        </ul>
      )}

      <div className="mt-4 border-t border-bordure pt-3">
        <Bouton
          variante="contour"
          className="w-full"
          chargement={cherche}
          disabled={motifNettoye.length < 2}
          onClick={() => void chercher()}
        >
          <Search />
          Chercher dans tout le catalogue
        </Bouton>
        {horsAttendu.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {horsAttendu.map((r) => (
              <PropositionRef
                key={r.code_reference}
                ref_={r}
                deja={dejaSaisies.includes(r.code_reference)}
                horsCommande
                surChoix={() => surChoix(r)}
              />
            ))}
          </ul>
        )}
      </div>
    </FeuilleMobile>
  )
}

function PropositionRef({
  ref_,
  deja,
  horsCommande = false,
  surChoix,
}: {
  ref_: RefLigne
  deja: boolean
  horsCommande?: boolean
  surChoix: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={surChoix}
        className="flex w-full items-center gap-3 rounded-[var(--radius)] border border-bordure bg-surface px-3 py-2.5 text-left transition-colors hover:bg-attenue/40"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{ref_.code_reference}</span>
            {deja && <Badge ton="info">déjà saisie</Badge>}
            {horsCommande && <Badge ton="neutre">hors commande</Badge>}
          </div>
          <div className="truncate text-[12px] text-attenue-texte">{ref_.designation}</div>
        </div>
        {ref_.qte_a_commander_kg != null && ref_.qte_a_commander_kg > 0 && (
          <span className="shrink-0 text-[12px] tabular-nums text-attenue-texte">
            reste {fmt.nombre(ref_.qte_a_commander_kg, 0)} kg
          </span>
        )}
        <Plus className="size-4 shrink-0 text-attenue-texte" />
      </button>
    </li>
  )
}
