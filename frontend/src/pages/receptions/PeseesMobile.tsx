/**
 * PeseesMobile — la pesee d'une reception AU DOIGT, sous 768 px.
 *
 * POURQUOI UN ECRAN A PART. Au bureau, la pesee se tape dans une grille large
 * (`receptions/GrilleReception`, 24/10/2026) : une ligne, le ✓ a droite. Sur un telephone de
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
import { ArrowLeft, Check, Package, Pencil, Plus, Scale, Search, Trash2 } from 'lucide-react'
import {
  type LigneSaisie,
  type RefLigne,
  depuisReference,
  estPrete,
  kgDe,
  unitesDe,
} from '../../composants/GrilleLignes'
import type { ChampColis } from '../../lib/conditionnement'
import { Badge, Bouton, Champ, Etiq, Selecteur } from '../../composants/ui/base'
import { lireNombre } from '../../lib/nombres'
import { codesStatut, libelleStatut } from '../../lib/statuts'
import { StatutBadge } from '../../composants/StatutBadge'
import { cn, fmt } from '../../lib/utils'
import { libelleUnite, useMotsUnite } from '../../lib/motsUnite'

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
  /**
   * AU CONTROLE, LA PESEE EST FIGEE (regle 4) : poids, unite, BL, colis,
   * palettes, bobines, lot et derogation ne se changent plus, aucune ligne ne
   * s'ajoute ni ne se retire — le serveur le refuserait. Restent la qualite,
   * le magasin et les observations.
   */
  peseeFigee?: boolean
  /** Relier pesee, palettes et bobines (conditionnement du lot, sinon la fiche). */
  relier?: (l: LigneSaisie, source: ChampColis, valeur: string) => LigneSaisie
  surRetirer: (l: LigneSaisie) => void
}

/**
 * DEUX PESEES DU MEME LOT S'ADDITIONNENT (21/10/2026) : poids, palettes,
 * bobines, poids annonce et colis. Le serveur fait de meme.
 */
export function fondrePesee(garde: LigneSaisie, ajout: LigneSaisie): LigneSaisie {
  const additionner = (a: string | undefined, b: string | undefined) => {
    const x = lireNombre(a ?? '')
    const y = lireNombre(b ?? '')
    return x == null && y == null ? '' : String(Number(((x ?? 0) + (y ?? 0)).toFixed(4)))
  }
  return {
    ...garde,
    qte: additionner(garde.qte, ajout.qte),
    palettes: additionner(garde.palettes, ajout.palettes),
    bobines: additionner(garde.bobines, ajout.bobines),
    extra: {
      ...garde.extra,
      bl: additionner(garde.extra?.bl, ajout.extra?.bl),
      colis: additionner(garde.extra?.colis, ajout.extra?.colis),
    },
  }
}

/** Les statuts qualite, libelles de la table commune (lib/statuts). */
const QUALITES = codesStatut('statut_qualite').map((valeur) => ({ valeur, libelle: libelleStatut('statut_qualite', valeur) }))

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
  peseeFigee = false,
  relier,
  surRetirer,
}: PeseesMobileProps) {
  /* La ligne en cours d'edition est une COPIE : on ne touche aux lignes du
     document qu'a « Valider la ligne ». Fermer sans valider ne change rien. */
  const [edite, setEdite] = useState<LigneSaisie | null>(null)
  const [estNouvelle, setEstNouvelle] = useState(false)
  const [ajout, setAjout] = useState(false)
  /* Ce qu'une pesee du meme lot vient d'additionner, dit une fois. */
  const [fusion, setFusion] = useState<string | null>(null)

  /*
   * LES LIGNES ATTENDUES SONT DEJA LA (16/10/2026).
   *
   * On ne part plus d'un ecran vide a remplir : une reception n'invente rien,
   * elle CONSTATE ce qu'un bon de commande attendait. Les lignes des bons
   * retenus se presentent donc d'emblee, et il ne reste qu'a taper le poids
   * pese sur la ligne qui existe — sans chercher la reference, sans ouvrir de
   * feuille. C'est le geste de MIGO contre bon de commande.
   *
   * L'ajout libre reste, pour ce qui arrive sans avoir ete commande.
   */
  const attendues = useMemo(
    () =>
      // AU CONTROLE, rien ne s'ajoute : les lignes attendues ne se proposent plus.
      peseeFigee
        ? []
        : proposees.filter(
            (p) => !lignes.some((l) => (l.extra?.id_ligne_bc ?? '') === (p.id_ligne_bc ?? '')),
          ),
    [proposees, lignes, peseeFigee],
  )

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

  /*
   * UNE LIGNE PAR REFERENCE ET PAR LOT (21/10/2026). Une NOUVELLE pesee de la
   * meme ligne de bon (ou de la meme reference hors commande) et du meme lot
   * s'ADDITIONNE a la ligne qui le porte deja : poids, colis, palettes,
   * bobines, poids annonce. Un autre lot fait une autre ligne. Le serveur fait
   * de meme, et la base refuse le doublon.
   */
  const cleLot = (l: LigneSaisie) =>
    `${l.extra?.id_ligne_bc || l.code_reference}|${(l.extra?.lot ?? '').trim()}`
  const valider = () => {
    if (!edite) return
    const fige: LigneSaisie = { ...edite, valide: true }
    const meme = estNouvelle ? lignes.find((x) => cleLot(x) === cleLot(fige)) : undefined
    if (meme) {
      setLignes((ls) => ls.map((x) => (x.cle !== meme.cle ? x : fondrePesee(x, fige))))
      setFusion(
        `${fige.code_reference} : même lot que la ligne ${lignes.indexOf(meme) + 1}, la pesée s’y ajoute (une ligne par lot).`,
      )
    } else {
      setFusion(null)
      setLignes((ls) =>
        estNouvelle ? [...ls, fige] : ls.map((x) => (x.cle === fige.cle ? fige : x)),
      )
    }
    fermer()
  }

  const retirer = () => {
    if (edite && !estNouvelle) surRetirer(edite)
    fermer()
  }

  const poser = (patch: Partial<LigneSaisie>) => setEdite((e) => (e ? { ...e, ...patch } : e))
  /* LE POIDS, LES PALETTES ET LES BOBINES SE REPONDENT, comme au bureau. */
  const poserColis = (source: ChampColis, valeur: string) =>
    setEdite((e) => {
      if (!e) return e
      if (relier) return relier(e, source, valeur)
      return { ...e, [source === 'quantite' ? 'qte' : source]: valeur }
    })
  const poserExtra = (cle: string, v: string) =>
    setEdite((e) => (e ? { ...e, extra: { ...e.extra, [cle]: v } } : e))

  return (
    <div className="px-3 py-3">
      {attendues.length > 0 && (
        <section className="mb-3">
          {/* EN LECTURE (21/10/2026) : ce qui est attendu se lit ici ; la
              pesee se saisit en bas, dans la feuille qu'ouvre un toucher. */}
          <h3 className="mb-1.5 text-[13px] font-medium">
            Attendu sur les bons — touchez une ligne pour la peser
          </h3>
          <ul className="divide-y divide-bordure overflow-hidden rounded-[var(--radius)] border border-bordure">
            {attendues.map((p) => (
              <LigneAttendue
                key={p.id_ligne_bc ?? p.code_reference}
                attendue={p}
                surPeser={() => ouvrirNouvelle(p)}
              />
            ))}
          </ul>
        </section>
      )}

      {fusion && (
        <p className="mb-2 rounded-[var(--radius)] border border-alerte/40 bg-alerte/5 px-3 py-2 text-[12.5px]">
          {fusion}
        </p>
      )}

      {lignes.length === 0 && attendues.length === 0 ? (
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

      {!peseeFigee && (
        <Bouton variante="contour" className="mt-3 w-full" onClick={() => setAjout(true)}>
          <Plus />
          Ajouter une ligne pesée
        </Bouton>
      )}

      {ajout && (
        <FeuilleAjout
          proposees={proposees}
          chercherCatalogue={chercherCatalogue}
          /* DEJA SAISIE SE JUGE SUR LA LIGNE DE BON quand il y en a une : la
             meme reference peut etre attendue sur deux bons du meme camion, et
             en peser une ne solde pas l'autre. */
          dejaSaisies={lignes.map((l) => l.extra?.id_ligne_bc || l.code_reference)}
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
          peseeFigee={peseeFigee}
          estNouvelle={estNouvelle}
          poser={poser}
          poserColis={poserColis}
          poserExtra={poserExtra}
          surValider={valider}
          surRetirer={retirer}
          surFermer={fermer}
        />
      )}
    </div>
  )
}

/**
 * UNE LIGNE QUE LE BON ATTEND : identite a gauche, poids a taper a droite.
 *
 * UN SEUL BALISAGE pour les deux tailles d'ecran. Au bureau la grille se
 * deplie en rangee dense que l'on parcourt au clavier (Entree valide la ligne
 * et passe a la suivante) ; sur telephone elle s'empile en carte. Pas de
 * tableau a faire defiler lateralement (regle d'ecran du 10/10).
 */
function LigneAttendue({
  attendue,
  surPeser,
}: {
  attendue: RefLigne
  surPeser: () => void
}) {
  const attendu = attendue.qte_a_commander_kg ?? 0
  return (
    <li>
      <button
        type="button"
        onClick={surPeser}
        aria-label={`Peser ${attendue.code_reference}`}
        className="grid w-full gap-1.5 px-3 py-2.5 text-left transition-colors hover:bg-attenue/40 md:grid-cols-[1fr_auto_auto] md:items-center md:gap-3"
      >
        <div className="min-w-0">
          <div className="truncate text-[14px] font-medium">
            {attendue.designation ?? attendue.code_reference}
          </div>
          <div className="truncate text-[12px] text-attenue-texte">
            {attendue.code_reference}
            {attendue.numero_bc && <> · {attendue.numero_bc}</>}
          </div>
        </div>
        <div className="text-[12.5px] tabular-nums text-attenue-texte md:text-right">
          attendu {fmt.nombre(attendu, 2)} kg
        </div>
        <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-primaire">
          <Scale className="size-4" />
          Peser
        </span>
      </button>
    </li>
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
  /* L'ATTENDU, L'ECART ET LE LOT SE LISENT SUR LA CARTE (24/10/2026) : un
     telephone n'a pas de survol. */
  const secondaires = [
    e.lot ? `Lot ${e.lot}` : 'Lot non relevé',
    e.magasin ? `Magasin ${e.magasin}` : null,
    e.colis ? `${e.colis} colis (BL)` : null,
    e.bl ? `${fmt.nombre(Number(e.bl), 2)} kg annoncés` : null,
  ].filter(Boolean) as string[]

  /*
   * CE QUI SE LIT EN SURVOL, pas dans la ligne (ADR-003 phase A) : l'attendu,
   * l'ecart et le lot. La ligne garde les six grandeurs du quai — reference,
   * commande, pese, palettes, bobines — et ne deborde pas.
   *
   * L'ECART HORS TOLERANCE RESTE VISIBLE, lui : sur un telephone il n'y a pas
   * de survol, et c'est le seul chiffre qui demande une decision tout de suite.
   */
  const infobulle = [
    ligne.suggere_kg != null ? `Attendu ${fmt.nombre(ligne.suggere_kg, 2)} kg` : 'Rien d’attendu',
    ecart != null
      ? `Écart ${ecart.kg > 0 ? '+' : ''}${fmt.nombre(ecart.kg, 2)} kg (${fmt.nombre(ecart.pct, 1)} %)`
      : null,
    e.lot ? `Lot ${e.lot}` : 'Lot non relevé',
    e.numero_bc ? `Bon ${e.numero_bc}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <li>
      <button
        type="button"
        onClick={surOuvrir}
        title={infobulle}
        className={cn(
          'flex w-full items-start gap-3 rounded-[var(--radius)] border bg-surface px-3 py-2.5 text-left transition-colors hover:bg-attenue/40',
          hors ? 'border-danger/50' : 'border-bordure',
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{ligne.code_reference || '—'}</span>
            {/* LE BON QUE CETTE LIGNE SERT. Un arrivage en couvre plusieurs :
                sans ce repere, le magasinier ne sait pas contre quelle commande
                il pese. */}
            {e.numero_bc && (
              <span className="shrink-0 rounded-[var(--radius-sm)] bg-attenue px-1.5 py-0.5 text-[11px] text-attenue-texte">
                {e.numero_bc}
              </span>
            )}
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
                / {fmt.nombre(ligne.suggere_kg, 0)} kg commandés
              </span>
            )}
            {ligne.palettes.trim() !== '' && (
              <span className="text-[12px] text-attenue-texte tabular-nums">
                {fmt.nombre(Number(ligne.palettes), 2)} pal.
              </span>
            )}
            {ligne.bobines.trim() !== '' && (
              <span className="text-[12px] text-attenue-texte tabular-nums">
                {fmt.nombre(Number(ligne.bobines), 0)} bob.
              </span>
            )}
            {ecart != null && (
              <span
                className={cn(
                  'text-[12px] tabular-nums',
                  hors ? 'font-medium text-danger' : ecart.pct < -tolerancePct ? 'text-alerte' : 'text-succes',
                )}
              >
                {ecart.kg > 0 ? '+' : ''}
                {fmt.nombre(ecart.kg, 1)} kg ({ecart.pct > 0 ? '+' : ''}
                {fmt.nombre(ecart.pct, 1)} %) ·{' '}
                {hors ? 'hors tolérance' : ecart.pct < -tolerancePct ? 'partielle' : 'conforme'}
              </span>
            )}
          </div>

          <div className="mt-1 space-y-0.5 text-[12px] text-attenue-texte">
            {secondaires.length > 0 && <div className="truncate">↳ {secondaires.join(' · ')}</div>}
            <div className="flex items-center gap-1.5">
              <span className="shrink-0">↳</span>
              <StatutBadge entite="statut_qualite" code={e.qualite ?? 'CONFORME'} />
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
  peseeFigee,
  estNouvelle,
  poser,
  poserColis,
  poserExtra,
  surValider,
  surRetirer,
  surFermer,
}: {
  ligne: LigneSaisie
  magasins: Magasin[]
  tolerancePct: number
  brouillon: boolean
  peseeFigee: boolean
  estNouvelle: boolean
  poser: (patch: Partial<LigneSaisie>) => void
  poserColis: (source: ChampColis, valeur: string) => void
  poserExtra: (cle: string, v: string) => void
  surValider: () => void
  surRetirer: () => void
  surFermer: () => void
}) {
  /** Le mot du conditionnement de la ligne (07/11/2026) : bobines, fûts, sacs… */
  const mots = useMotsUnite()(ligne.code_reference)
  const e = ligne.extra ?? {}
  const ecart = ecartVsAttendu(ligne)
  const hors = ecart != null && ecart.pct > tolerancePct
  const prete = estPrete(ligne, true)
  const derog = e.derog === '1'
  const unites = unitesDe(ligne)

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
          {/* Au controle, une ligne ne se retire pas : le serveur le refuse. */}
          {(!peseeFigee || estNouvelle) && (
            <Bouton
              variante="contour"
              className="text-danger hover:bg-danger/10"
              onClick={surRetirer}
            >
              <Trash2 />
              {estNouvelle ? 'Abandonner' : 'Retirer'}
            </Bouton>
          )}
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
            autoFocus={!peseeFigee}
            disabled={peseeFigee}
            value={ligne.qte}
            onChange={(ev) => poserColis('quantite', ev.target.value)}
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

        {/* PALETTES ET BOBINES, comptees au quai : elles se repondent avec le
            poids tant que la ligne est liee (24/10/2026). */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Etiq htmlFor="pm-pal">Palettes</Etiq>
            <Champ
              id="pm-pal"
              type="number"
              min="0"
              inputMode="decimal"
              disabled={peseeFigee}
              value={ligne.palettes}
              onChange={(ev) => poserColis('palettes', ev.target.value)}
              className="h-11 text-right text-[16px] tabular-nums"
              aria-label="Nombre de palettes"
            />
          </div>
          <div>
            <Etiq htmlFor="pm-bob">{mots.Des}</Etiq>
            <Champ
              id="pm-bob"
              type="number"
              min="0"
              inputMode="numeric"
              disabled={peseeFigee}
              value={ligne.bobines}
              onChange={(ev) => poserColis('bobines', ev.target.value)}
              className="h-11 text-right text-[16px] tabular-nums"
              aria-label={`Nombre de ${mots.des}`}
            />
          </div>
          <label className="col-span-2 flex items-center gap-2 text-[12.5px] text-attenue-texte">
            <input
              type="checkbox"
              checked={ligne.lie}
              disabled={peseeFigee}
              onChange={(ev) => poser({ lie: ev.target.checked })}
              className="size-4"
              aria-label={ligne.lie ? 'Détacher le calcul' : 'Relier le calcul'}
            />
            Poids, palettes et {mots.des} liés (décochez pour une palette entamée)
          </label>
          {unites.length > 0 && (
            <div className="col-span-2">
              <Etiq htmlFor="pm-unite">Unité d’archivage</Etiq>
              <Selecteur
                id="pm-unite"
                value={ligne.unite}
                disabled={peseeFigee}
                onChange={(ev) => poser({ unite: ev.target.value })}
                aria-label="Unité de saisie"
              >
                <option value="kg">kg</option>
                {unites.map((u) => (
                  <option key={u} value={u}>
                    {libelleUnite(u, mots)}
                  </option>
                ))}
              </Selecteur>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Etiq htmlFor="pm-lot">Lot fournisseur</Etiq>
            <Champ
              id="pm-lot"
              disabled={peseeFigee}
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
              disabled={peseeFigee}
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
              disabled={peseeFigee}
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

        <div>
          <Etiq htmlFor="pm-notes">Observations</Etiq>
          <Champ
            id="pm-notes"
            value={e.notes ?? ''}
            onChange={(ev) => poserExtra('notes', ev.target.value)}
            placeholder="Emballage abîmé, couleur douteuse…"
            aria-label="Observations"
          />
        </div>

        {hors && (
          <label className="flex items-start gap-2 rounded-[var(--radius)] border border-danger/40 bg-danger/5 px-3 py-2 text-[13px]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={derog}
              disabled={!brouillon || peseeFigee}
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
                  disabled={!brouillon || peseeFigee}
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
          {/* LA CLE EST LA LIGNE DE BON, pas la reference : un arrivage
              couvre plusieurs bons, et la meme reference y est attendue deux
              fois. Keyee par reference, la seconde proposition disparaissait. */}
          {attendues.map((r) => (
            <PropositionRef
              key={r.id_ligne_bc ?? r.code_reference}
              ref_={r}
              deja={dejaSaisies.includes(r.id_ligne_bc ?? r.code_reference)}
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
            {/* CONTRE QUEL BON on pese : deux lignes de deux bons ne se
                distinguent que par lui. */}
            {ref_.numero_bc && (
              <span className="shrink-0 rounded-[var(--radius-sm)] bg-attenue px-1.5 py-0.5 text-[11px] text-attenue-texte">
                {ref_.numero_bc}
              </span>
            )}
            {deja && <Badge ton="info">déjà saisie — même lot : s’ajoute</Badge>}
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
