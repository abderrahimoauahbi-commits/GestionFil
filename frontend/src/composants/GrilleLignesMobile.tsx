/**
 * GrilleLignesMobile — la saisie des lignes AU DOIGT, sous 768 px.
 *
 * `GrilleLignes` est un tableau large (reference, unite, quantite, prix, total,
 * palettes/bobines, remise, fournisseur, colonnes du document, actions). Au
 * telephone il deborde et le « Ajouter une ligne » tombe sous l'ecran (constat
 * e2e du 14/10). Ici, chaque ligne devient une CARTE, et son edition s'ouvre en
 * FEUILLE plein ecran — jamais une fenetre surgissante.
 *
 * MEME ETAT, MEME SEMANTIQUE QUE LA GRILLE. On edite la MEME `LigneSaisie` en
 * direct dans `lignes` (pas de copie), avec les memes conversions kg↔palettes↔
 * bobines, les memes drapeaux (sansPrix, validationLocale, surEnregistrerLigne…)
 * et les memes colonnes supplementaires, que le document fournit et sait rendre.
 * Rien de ce qui est garanti par le serveur ne change : c'est une mise en page.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, Check, Link2, Pencil, Plus, Trash2, Unlink2 } from 'lucide-react'
import {
  type ColonneGrille,
  type LigneSaisie,
  type ProprietesGrille,
  type RefLigne,
  UNITES_LIBRES,
  autreLigneMemeReference,
  depuisReference,
  fondreLigne,
  estEbauche,
  estPrete,
  kgDe,
  ligneVide,
  totalDe,
  unitesDe,
} from './GrilleLignes'
import { ChampRecherche, type Suggestion } from './ChampRecherche'
import { AvisColisage } from './AvisColisage'
import { classeNiveauEcart, couleurEcart } from '../lib/lots'
import {
  depuisBobines,
  depuisKg,
  depuisPalettes,
  facteurVersKg,
  pourChamp,
} from '../lib/conditionnement'
import { Badge, Bouton, Champ, Etiq, Selecteur } from './ui/base'
import { cn, fmt } from '../lib/utils'
import { libelleUnite, useMotsUnite } from '../lib/motsUnite'
import { libelleStatut } from '../lib/statuts'

/** Les états d'une référence au moteur de couverture (27/10/2026). */
const ETATS_MOTEUR = ['RUPTURE_INEVITABLE', 'SOUS_SECURITE', 'SOUS_CIBLE', 'COUVERT']


export function GrilleLignesMobile({
  codeFournisseur,
  devise,
  lignes,
  setLignes,
  mode,
  setMode,
  proposees,
  chercherCatalogue,
  dejaPrises,
  surCorrection,
  valeurOrigine,
  surCreerReference,
  modifiable = true,
  surEnregistrerLigne,
  surSupprimerLigne,
  enCours,
  modifiees,
  colonnesSupplementaires = [],
  sansPrix = false,
  sansFournisseur = false,
  validationLocale = false,
  avecRemise = false,
  sansSource = false,
  sansAjout = false,
  referenceFigee = false,
  unitesAutorisees,
  doublonsReference = false,
  fusionParReference = false,
  libelles,
  poidsBobine,
  controleColisage = false,
}: ProprietesGrille) {
  const [ouverte, setOuverte] = useState<string | null>(null)
  const ligne = lignes.find((l) => l.cle === ouverte) ?? null

  const prises = doublonsReference || fusionParReference
    ? new Set<string>()
    : (dejaPrises ?? new Set(lignes.map((l) => l.code_reference).filter(Boolean)))

  const maj = (cle: string, patch: Partial<LigneSaisie>) =>
    setLignes((ls) => ls.map((l) => (l.cle === cle ? { ...l, ...patch } : l)))

  /* Editer DEVALIDE : une ligne figee qu'on rouvre et modifie doit etre
     revalidee, comme au bureau (ou le cadenas se retire au crayon). */
  const majE = (cle: string, patch: Partial<LigneSaisie>) =>
    maj(cle, { ...patch, valide: false })

  const majColis = (cle: string, source: 'quantite' | 'palettes' | 'bobines', valeur: string) =>
    setLignes((ls) =>
      ls.map((l) => {
        if (l.cle !== cle) return l
        const champ = source === 'quantite' ? 'qte' : source
        if (l.nature !== 'MARCHANDISE' || !l.lie) return { ...l, [champ]: valeur, valide: false }
        const r =
          source === 'palettes'
            ? depuisPalettes(valeur, l.cond)
            : source === 'bobines'
              ? depuisBobines(valeur, l.cond)
              : depuisKg(valeur, l.cond)
        return {
          ...l,
          valide: false,
          saisiePar: source,
          qte: source === 'quantite' ? valeur : pourChamp(r.kg, 2),
          palettes: source === 'palettes' ? valeur : pourChamp(r.palettes),
          bobines: source === 'bobines' ? valeur : pourChamp(r.bobines),
        }
      }),
    )

  const versSuggestion = (r: RefLigne): Suggestion => {
    const suggere = r.qte_a_commander_kg ?? 0
    const etranger = !!r.code_fournisseur && r.code_fournisseur !== codeFournisseur
    return {
      valeur: r.code_reference,
      titre: r.code_reference,
      detail:
        [
          r.designation,
          // L'état au moteur de couverture (27/10/2026) : la 1re rupture du plan.
          r.premiere_rupture ? `rupture le ${fmt.date(r.premiere_rupture)}` : null,
          etranger ? `habituellement chez ${r.fournisseur_nom ?? r.code_fournisseur}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
      mention:
        suggere > 0
          ? `plan : ${fmt.nombre(suggere, 0)} kg`
          : r.statut_stock && r.statut_stock !== 'COUVERT'
            ? // Un état du moteur se traduit ; une mention libre (le stock du magasin
              // d'une sortie, « RUPTURE » quand il est vide) passe telle quelle.
              ETATS_MOTEUR.includes(r.statut_stock)
              ? libelleStatut('statut_stock', r.statut_stock)
              : r.statut_stock
            : undefined,
      ton:
        suggere > 0
          ? 'primaire'
          : r.statut_stock === 'RUPTURE_INEVITABLE' || r.statut_stock === 'RUPTURE'
            ? 'alerte'
            : 'neutre',
      desactivee: prises.has(r.code_reference),
      charge: r,
    }
  }

  const chercher = async (motif: string): Promise<Suggestion[]> => {
    if (sansSource) {
      const mots = motif.toLowerCase().split(/\s+/).filter(Boolean)
      const locales = proposees.filter((r) =>
        mots.every((m) => `${r.code_reference} ${r.designation ?? ''}`.toLowerCase().includes(m)),
      )
      const autres = motif.trim().length >= 2 ? await chercherCatalogue(motif) : []
      const vus = new Set(locales.map((r) => r.code_reference))
      return [...locales, ...autres.filter((r) => !vus.has(r.code_reference))].slice(0, 25).map(versSuggestion)
    }
    if (mode === 'PLAN') {
      const mots = motif.toLowerCase().split(/\s+/).filter(Boolean)
      return proposees
        .filter((r) =>
          mots.every((m) => `${r.code_reference} ${r.designation ?? ''}`.toLowerCase().includes(m)),
        )
        .slice(0, 25)
        .map(versSuggestion)
    }
    return (await chercherCatalogue(motif)).map(versSuggestion)
  }

  const ajouter = () => {
    const l = ligneVide()
    setLignes((ls) => [...ls, l])
    setOuverte(l.cle)
  }

  const retirer = (l: LigneSaisie) => {
    if (l.idExistant && surSupprimerLigne) surSupprimerLigne(l)
    else setLignes((ls) => ls.filter((x) => x.cle !== l.cle))
    setOuverte(null)
  }

  /* Fermer une ligne restee VIDE l'efface : un tap « Ajouter » qu'on abandonne
     ne doit pas laisser une carte fantome. Une ligne commencee reste. */
  const fermer = () => {
    if (ligne && !ligne.code_reference && !ligne.intitule.trim() && !ligne.idExistant) retirer(ligne)
    setOuverte(null)
  }

  return (
    <div className="space-y-3">
      {!sansSource && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-[var(--radius)] border border-bordure">
            {(
              [
                ['PLAN', 'Du plan d’achat'],
                ['CATALOGUE', 'Tout le catalogue'],
              ] as const
            ).map(([m, libelle]) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  'px-2.5 py-1.5 text-[12px]',
                  mode === m
                    ? 'bg-primaire/10 font-medium text-primaire'
                    : 'text-attenue-texte hover:bg-attenue/50',
                )}
              >
                {libelle}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-attenue-texte">{proposees.length} proposition(s)</span>
        </div>
      )}

      {lignes.length === 0 ? (
        <p className="rounded-[var(--radius)] border border-dashed border-bordure px-4 py-8 text-center text-[13px] text-attenue-texte">
          Aucune ligne. {sansAjout ? 'Les lignes viennent du document.' : 'Ajoutez-en une ci-dessous.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {lignes.map((l, i) => (
            <CarteLigne
              key={l.cle}
              ligne={l}
              index={i}
              sansPrix={sansPrix}
              devise={devise}
              validationLocale={validationLocale}
              colonnesSupplementaires={colonnesSupplementaires}
              surOuvrir={() => setOuverte(l.cle)}
            />
          ))}
        </ul>
      )}

      {!sansAjout && (
        <Bouton variante="contour" className="w-full" onClick={ajouter} disabled={!modifiable}>
          <Plus />
          Ajouter une ligne
        </Bouton>
      )}

      {ligne && (
        <FeuilleLigne
          ligne={ligne}
          codeFournisseur={codeFournisseur}
          devise={devise}
          modifiable={modifiable}
          referenceFigee={referenceFigee}
          sansPrix={sansPrix}
          sansFournisseur={sansFournisseur}
          sansSource={sansSource}
          avecRemise={avecRemise}
          validationLocale={validationLocale}
          controleColisage={controleColisage}
          poidsBobine={poidsBobine}
          unitesAutorisees={unitesAutorisees}
          colonnesSupplementaires={colonnesSupplementaires}
          enCours={enCours}
          modifiees={modifiees}
          libelles={libelles}
          mode={mode}
          chercher={chercher}
          prises={prises}
          surChoixRef={(s) => maj(ligne.cle, depuisReference(s.charge as RefLigne, ligne.cle))}
          surChangerRef={() =>
            majE(ligne.cle, { nature: 'MARCHANDISE', code_reference: '', intitule: '', cond: {}, suggere_kg: null })
          }
          surGarderLibre={(motif) => majE(ligne.cle, { nature: 'LIBRE', intitule: motif, unite: 'Forfait', qte: '1' })}
          surCatalogue={() => setMode('CATALOGUE')}
          surCreerReference={surCreerReference}
          maj={(patch) => majE(ligne.cle, patch)}
          majColis={(source, v) => majColis(ligne.cle, source, v)}
          surCorrection={surCorrection}
          valeurOrigine={valeurOrigine}
          surValider={() => {
            /* UNE LIGNE PAR REFERENCE (bon de commande, 21/10/2026) : la ligne
               qui repete une reference se fond dans celle qui la porte. */
            const i = fusionParReference && !ligne.idExistant ? autreLigneMemeReference(lignes, ligne) : -1
            if (i >= 0) {
              const cible = lignes[i].cle
              setLignes((ls) =>
                ls.filter((x) => x.cle !== ligne.cle).map((x) => (x.cle === cible ? fondreLigne(x, ligne) : x)),
              )
            } else maj(ligne.cle, { valide: true })
            setOuverte(null)
          }}
          surEnregistrer={surEnregistrerLigne ? () => surEnregistrerLigne(ligne) : undefined}
          surRetirer={() => retirer(ligne)}
          surFermer={fermer}
        />
      )}
    </div>
  )
}

/** Une ligne en carte : ce qui l'identifie et la quantite en tete, le reste en « ↳ ». */
function CarteLigne({
  ligne,
  index,
  sansPrix,
  devise,
  validationLocale,
  colonnesSupplementaires,
  surOuvrir,
}: {
  ligne: LigneSaisie
  index: number
  sansPrix: boolean
  devise: string
  validationLocale: boolean
  colonnesSupplementaires: ColonneGrille[]
  surOuvrir: () => void
}) {
  const kg = kgDe(ligne)
  const marchandise = ligne.nature === 'MARCHANDISE'
  const prete = estPrete(ligne, sansPrix)
  const ecart = ligne.suggere_kg && kg != null ? kg - ligne.suggere_kg : null
  const extras = colonnesSupplementaires
    .map((c) => ligne.extra?.[c.cle])
    .filter((v) => v && v.trim())
    .join(' · ')
  const colis = [
    ligne.palettes && Number(ligne.palettes) ? `${ligne.palettes} pal.` : null,
    ligne.bobines && Number(ligne.bobines) ? `${ligne.bobines} bob.` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <li>
      <button
        type="button"
        onClick={surOuvrir}
        className="flex w-full items-start gap-2 rounded-[var(--radius)] border border-bordure bg-surface px-3 py-2.5 text-left transition-colors hover:bg-attenue/40"
      >
        <span className="pt-0.5 text-[12px] tabular-nums text-attenue-texte">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">
              {ligne.code_reference || ligne.intitule || <span className="text-attenue-texte">à compléter</span>}
            </span>
            {!marchandise && ligne.intitule && <Badge ton="alerte">libre</Badge>}
            {validationLocale &&
              (ligne.valide ? (
                <Badge ton="succes">validée</Badge>
              ) : prete ? (
                <Badge ton="info">à valider</Badge>
              ) : (
                <Badge ton="neutre">incomplète</Badge>
              ))}
          </div>
          {marchandise && ligne.intitule && ligne.intitule !== ligne.code_reference && (
            <div className="truncate text-[12px] text-attenue-texte">{ligne.intitule}</div>
          )}
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-[15px] font-semibold tabular-nums">
              {kg == null ? '—' : `${fmt.nombre(kg, 2)} kg`}
            </span>
            {ligne.unite !== 'kg' && <span className="text-[12px] text-attenue-texte">{ligne.unite}</span>}
            {!sansPrix && Number(ligne.prix) > 0 && (
              <span className="text-[12px] tabular-nums text-attenue-texte">
                {fmt.nombre(totalDe(ligne), 2)} {devise}
              </span>
            )}
            {ecart != null && Math.abs(ecart) > 0.5 && (
              <span className="text-[12px] tabular-nums text-alerte">
                {ecart > 0 ? '+' : ''}
                {fmt.nombre(ecart, 0)} kg / plan
              </span>
            )}
          </div>
          {(colis || extras) && (
            <div className="mt-0.5 truncate text-[12px] text-attenue-texte">
              ↳ {[colis, extras].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        <Pencil className="mt-0.5 size-4 shrink-0 text-attenue-texte" />
      </button>
    </li>
  )
}

/** La feuille plein ecran d'edition d'une ligne. */
function FeuilleLigne(p: {
  ligne: LigneSaisie
  codeFournisseur: string
  devise: string
  modifiable: boolean
  referenceFigee: boolean
  sansPrix: boolean
  sansFournisseur: boolean
  sansSource: boolean
  avecRemise: boolean
  validationLocale: boolean
  controleColisage: boolean
  poidsBobine?: { orange: number; rouge: number }
  unitesAutorisees?: string[]
  colonnesSupplementaires: ColonneGrille[]
  enCours?: Set<string>
  modifiees?: Set<string>
  libelles?: ProprietesGrille['libelles']
  mode: 'PLAN' | 'CATALOGUE'
  chercher: (motif: string) => Promise<Suggestion[]>
  prises: Set<string>
  surChoixRef: (s: Suggestion) => void
  surChangerRef: () => void
  surGarderLibre: (motif: string) => void
  surCatalogue: () => void
  surCreerReference?: (motif: string) => void
  maj: (patch: Partial<LigneSaisie>) => void
  majColis: (source: 'quantite' | 'palettes' | 'bobines', valeur: string) => void
  surCorrection?: (code: string, champ: string, valeur: string) => void
  valeurOrigine?: (code: string, champ: string) => string
  surValider: () => void
  surEnregistrer?: () => void
  surRetirer: () => void
  surFermer: () => void
}) {
  const { ligne: l } = p
  /** Le mot du conditionnement de la ligne (07/11/2026) : bobines, fûts, sacs… */
  const mots = useMotsUnite()(l.code_reference)
  const marchandise = l.nature === 'MARCHANDISE'
  const kg = kgDe(l)
  const prete = estPrete(l, p.sansPrix)
  const aReference = !!l.code_reference || (!marchandise && !!l.intitule)
  const f = facteurVersKg(l.unite, l.cond)

  const pied: ReactNode = (
    <>
      <Bouton variante="contour" className="text-danger hover:bg-danger/10" onClick={p.surRetirer}>
        <Trash2 />
        {l.idExistant ? 'Supprimer' : 'Retirer'}
      </Bouton>
      {p.validationLocale ? (
        <Bouton className="ml-auto" disabled={!prete} onClick={p.surValider}>
          <Check />
          Valider la ligne
        </Bouton>
      ) : p.surEnregistrer ? (
        <Bouton
          className="ml-auto"
          chargement={p.enCours?.has(l.cle)}
          disabled={!prete || (!!l.idExistant && !p.modifiees?.has(l.cle))}
          onClick={p.surEnregistrer}
        >
          <Check />
          {l.idExistant ? 'Enregistrer' : 'Ajouter'}
        </Bouton>
      ) : (
        <Bouton className="ml-auto" onClick={p.surFermer}>
          <Check />
          Terminer
        </Bouton>
      )}
    </>
  )

  return (
    <Feuille
      titre={aReference ? l.code_reference || l.intitule : 'Nouvelle ligne'}
      sousTitre={marchandise && l.intitule !== l.code_reference ? l.intitule : undefined}
      surFermer={p.surFermer}
      pied={pied}
    >
      <div className="space-y-4">
        {/* Reference */}
        {!aReference ? (
          <div>
            <Etiq>{p.libelles?.reference ?? 'Référence'}</Etiq>
            <ChampRecherche
              valeur=""
              chercher={p.chercher}
              cleCache={[p.mode, p.codeFournisseur, p.prises.size]}
              // Recherche vide : seulement la ou elle ne coute rien (plan en memoire,
              // propositions d'un document de stock) — comme au bureau (24/10/2026).
              chercherAVide={p.sansSource || p.mode === 'PLAN'}
              surChoix={p.surChoixRef}
              placeholder={
                p.libelles?.recherche ??
                (p.mode === 'PLAN' ? 'Référence — le plan propose…' : 'Référence — tout le catalogue…')
              }
              aide="Flèches pour parcourir, Entrée pour retenir."
              ariaLabel="Référence de la ligne"
              surAucun={(motif) => (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {p.mode === 'PLAN' && (
                    <Bouton variante="contour" taille="sm" onClick={p.surCatalogue}>
                      Chercher dans tout le catalogue
                    </Bouton>
                  )}
                  {p.surCreerReference && (
                    <Bouton variante="contour" taille="sm" onClick={() => p.surCreerReference?.(motif)}>
                      <Plus />
                      Ajouter au catalogue
                    </Bouton>
                  )}
                  {!p.sansSource && (
                    <Bouton variante="contour" taille="sm" onClick={() => p.surGarderLibre(motif)}>
                      Garder « {motif} » sans référence
                    </Bouton>
                  )}
                </div>
              )}
            />
          </div>
        ) : (
          <div className="flex items-start justify-between gap-2 rounded-[var(--radius)] border border-bordure bg-attenue/30 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate font-medium">{l.code_reference || l.intitule}</div>
              <div className="truncate text-[11px] text-attenue-texte">
                {marchandise ? 'notre code' : 'ligne libre'}
                {l.fournisseur_habituel && l.fournisseur_habituel !== p.codeFournisseur && (
                  <span className="text-alerte"> · habituellement chez {l.fournisseur_habituel}</span>
                )}
              </div>
            </div>
            {p.modifiable && !p.referenceFigee && (
              <button
                type="button"
                onClick={p.surChangerRef}
                className="shrink-0 text-[12px] text-attenue-texte underline hover:text-texte"
              >
                changer
              </button>
            )}
          </div>
        )}

        {/* Quantite + unite */}
        <div className="grid grid-cols-[1fr,7rem] gap-3">
          <div>
            <Etiq htmlFor="gm-qte" obligatoire>
              {marchandise ? 'Quantité (kg)' : 'Quantité'}
            </Etiq>
            <Champ
              id="gm-qte"
              type="number"
              step="any"
              min="0.0001"
              inputMode="decimal"
              value={l.qte}
              onChange={(e) => p.majColis('quantite', e.target.value)}
              className="h-12 text-right text-[18px] font-semibold tabular-nums"
              aria-label={marchandise ? 'Quantité en kilos' : 'Quantité'}
            />
            {marchandise && l.unite !== 'kg' && kg !== null && (
              <p className="mt-0.5 text-right text-[11px] tabular-nums text-attenue-texte">
                {f ? `= ${fmt.nombre(kg / f, 2)} ${l.unite.toLowerCase()}` : <span className="text-danger">non convertible</span>}
              </p>
            )}
          </div>
          <div>
            <Etiq htmlFor="gm-unite">{p.libelles?.unite ?? 'Unité'}</Etiq>
            <Selecteur
              id="gm-unite"
              value={l.unite}
              onChange={(e) => p.maj({ unite: e.target.value })}
              className="h-12"
              aria-label="Unité"
            >
              {marchandise ? (
                <>
                  <option value="kg">kg</option>
                  {unitesDe(l)
                    .filter((u) => !p.unitesAutorisees || p.unitesAutorisees.includes(u))
                    .map((u) => (
                      <option key={u} value={u}>
                        {libelleUnite(u, mots)}
                      </option>
                    ))}
                </>
              ) : (
                UNITES_LIBRES.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))
              )}
            </Selecteur>
          </div>
        </div>

        {/* Palettes / bobines */}
        {marchandise && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <Etiq>Palettes / {mots.des}</Etiq>
              <button
                type="button"
                onClick={() => p.maj({ lie: !l.lie })}
                className={cn('flex items-center gap-1 text-[11px]', l.lie ? 'text-primaire' : 'text-alerte')}
                aria-label={l.lie ? 'Détacher le calcul' : 'Relier le calcul'}
              >
                {l.lie ? <Link2 className="size-3.5" /> : <Unlink2 className="size-3.5" />}
                {l.lie ? 'reliés' : 'séparés'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Champ
                type="number"
                min="0"
                inputMode="numeric"
                value={l.palettes}
                onChange={(e) => p.majColis('palettes', e.target.value)}
                className="h-11 text-right tabular-nums"
                placeholder="palettes"
                aria-label="Nombre de palettes"
              />
              <Champ
                type="number"
                min="0"
                inputMode="numeric"
                value={l.bobines}
                onChange={(e) => p.majColis('bobines', e.target.value)}
                className="h-11 text-right tabular-nums"
                placeholder={mots.des}
                aria-label={`Nombre de ${mots.des}`}
              />
            </div>
            {p.controleColisage && (
              <AvisColisage kg={kg} bobines={l.bobines} palettes={l.palettes} cond={l.cond} mots={mots} className="mt-1.5" />
            )}
            {p.poidsBobine &&
              (() => {
                const bob = Number(l.bobines)
                const cat = Number(l.cond.poids_bobine_kg ?? 0)
                if (kg == null || !(bob > 0)) return null
                const reel = kg / bob
                const pct = cat > 0 ? ((reel - cat) / cat) * 100 : null
                const c = couleurEcart(pct, p.poidsBobine)
                return (
                  <p className="mt-1 text-[11px] tabular-nums text-attenue-texte">
                    Poids/{mots.un} {fmt.nombre(reel, 3)} kg
                    {pct != null && (
                      <span className={cn('ml-1', classeNiveauEcart(c) ?? 'text-succes')}>
                        ({pct > 0 ? '+' : ''}
                        {fmt.nombre(pct, 2)} % / cat. {fmt.nombre(cat, 3)})
                      </span>
                    )}
                  </p>
                )
              })()}
          </div>
        )}

        {/* Prix / remise */}
        {!p.sansPrix && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Etiq htmlFor="gm-prix">Prix {p.devise}{marchandise ? ' / kg' : ''}</Etiq>
              <Champ
                id="gm-prix"
                type="number"
                step="any"
                min="0.0001"
                inputMode="decimal"
                value={l.prix}
                onChange={(e) => p.maj({ prix: e.target.value })}
                className={cn(
                  'h-11 text-right tabular-nums',
                  !(Number(l.prix) > 0) && estEbauche(l, p.sansPrix) && 'border-danger',
                )}
                aria-label={marchandise ? `Prix ${p.devise} par kg` : `Prix ${p.devise}`}
              />
            </div>
            {p.avecRemise && (
              <div>
                <Etiq htmlFor="gm-remise">Remise %</Etiq>
                <Champ
                  id="gm-remise"
                  type="number"
                  step="any"
                  min="0"
                  max="99.99"
                  inputMode="decimal"
                  value={l.remise ?? ''}
                  onChange={(e) => p.maj({ remise: e.target.value })}
                  className="h-11 text-right tabular-nums"
                  placeholder="0"
                  aria-label="Remise en pourcentage"
                />
              </div>
            )}
          </div>
        )}
        {!p.sansPrix && (
          <div className="flex items-baseline justify-between border-t border-bordure pt-2">
            <span className="text-[12px] uppercase tracking-wider text-attenue-texte">Total ligne</span>
            <span className="text-[16px] font-semibold tabular-nums">
              {fmt.nombre(totalDe(l), 2)} {p.devise}
            </span>
          </div>
        )}

        {/* Champs fournisseur */}
        {!p.sansFournisseur && marchandise && (
          <div className="grid grid-cols-2 gap-3">
            {(['reference_fournisseur', 'couleur', 'code_couleur'] as const).map((champ) => (
              <div key={champ} className={champ === 'reference_fournisseur' ? 'col-span-2' : undefined}>
                <Etiq>
                  {champ === 'reference_fournisseur' ? 'Réf. fournisseur' : champ === 'couleur' ? 'Couleur' : 'Code couleur frs'}
                </Etiq>
                <Champ
                  value={l[champ]}
                  onChange={(e) => p.maj({ [champ]: e.target.value })}
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    const initial = p.valeurOrigine?.(l.code_reference, champ) ?? ''
                    if (v !== initial && l.code_reference && p.surCorrection) p.surCorrection(l.code_reference, champ, v)
                  }}
                  className="h-11"
                  placeholder={champ === 'reference_fournisseur' ? 'Ssl2279' : champ === 'couleur' ? 'Cream' : 'RED 7612'}
                />
              </div>
            ))}
          </div>
        )}

        {/* Colonnes du document (lot, magasin, qualité…) */}
        {p.colonnesSupplementaires.length > 0 && (
          <div className="grid grid-cols-1 gap-3 [&_input]:w-full [&_select]:w-full">
            {p.colonnesSupplementaires.map((c) => (
              <div key={c.cle}>
                <Etiq>{c.entete}</Etiq>
                {c.rendu(l, (valeur) => p.maj({ extra: { ...(l.extra ?? {}), [c.cle]: valeur } }))}
              </div>
            ))}
          </div>
        )}
      </div>
    </Feuille>
  )
}

/** Feuille plein ecran : en-tete avec retour, corps qui defile, pied d'actions. */
function Feuille({
  titre,
  sousTitre,
  surFermer,
  pied,
  children,
}: {
  titre: ReactNode
  sousTitre?: string
  surFermer: () => void
  pied: ReactNode
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
      <footer
        className="flex shrink-0 items-center gap-2 border-t border-bordure bg-surface px-3 py-2.5"
        style={{ paddingBottom: 'calc(0.625rem + var(--marge-sure-bas))' }}
      >
        {pied}
      </footer>
    </div>
  )
}
