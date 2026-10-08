/**
 * Le panneau d'apparence, glissant depuis la droite.
 *
 * POURQUOI UN PANNEAU ET NON UNE PAGE. On regle une couleur en la comparant a
 * ce qu'on regardait : le panneau laisse l'ecran visible a gauche — le
 * changement se voit pendant qu'on le fait.
 *
 * LES REGLAGES (06/10/2026), sur le modele du panneau de reglage fourni par la
 * direction : 1. style, mode, palette, cadres ; 2. police et taille ; 3. fond
 * (image, position, zoom, luminosite, contraste, saturation, flou, voile) ;
 * 4. verre des panneaux (transparence, flou, saturation, bordure, rayon) ;
 * 5. tableaux ; 6. fenetre.
 *
 * AUCUN BOUTON DE VALIDATION. Chaque reglage s'applique tout de suite et se
 * garde SUR LE COMPTE (voir `SynchroPreferences`) : on le retrouve a la
 * prochaine connexion, sur n'importe quel poste.
 */
import { useEffect, useRef, useState } from 'react'
import { ImagePlus, RotateCcw, Trash2, X } from 'lucide-react'
import {
  CADRES,
  CHARTES,
  DENSITES,
  DISPOSITIONS,
  PALETTES,
  POLICES,
  POSITIONS_FOND,
  TAILLES,
  TYPES_VERRE,
  useApparence,
  type Cadres,
  type Charte,
  type Densite,
  type Disposition,
  type Palette,
  type Police,
  type ReglageFond,
  type ReglageVerre,
  type Taille,
  type TypeVerre,
} from './Apparence'
import { useTheme, type Theme } from './Theme'
import { Bouton, Selecteur } from './ui/base'
import { Interrupteur } from './ui/surcouches'
import { cn } from '../lib/utils'

const MODES: { cle: Theme; nom: string }[] = [
  { cle: 'clair', nom: 'Clair' },
  { cle: 'sombre', nom: 'Sombre' },
  { cle: 'systeme', nom: 'Suivre le système' },
]

/** Un titre de section, numerote comme dans le panneau de reference. */
function Titre({ num, children }: { num: string; children: React.ReactNode }) {
  return (
    <h3 className="mb-3 mt-6 flex items-center gap-2 border-b border-bordure pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-attenue-texte first:mt-1">
      <span className="grid size-4 place-items-center rounded-full bg-primaire/15 text-[9px] text-primaire">{num}</span>
      {children}
    </h3>
  )
}

/** Une ligne de reglage : etiquette a gauche, selecteur a droite. */
function Ligne({ pour, nom, children }: { pour: string; nom: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2 py-1">
      <label htmlFor={pour} className="text-[12px] text-attenue-texte">
        {nom}
      </label>
      {children}
    </div>
  )
}

/** Le commentaire d'un choix : ce que le selecteur ne peut pas dire en un mot. */
function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[10.5px] leading-relaxed text-attenue-texte">{children}</p>
}

/** Un curseur : le nom et la valeur au-dessus, la glissiere dessous. */
function Curseur({
  nom,
  valeur,
  unite,
  min,
  max,
  pas = 1,
  inactif,
  surChange,
}: {
  nom: string
  valeur: number
  unite: string
  min: number
  max: number
  pas?: number
  inactif?: boolean
  surChange: (v: number) => void
}) {
  return (
    <label className={cn('mb-2.5 block', inactif && 'pointer-events-none opacity-40')}>
      <span className="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-[0.12em] text-attenue-texte">
        {nom}
        <span className="text-[11px] normal-case tracking-normal tabular-nums text-texte">
          {valeur}
          {unite}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={pas}
        value={valeur}
        disabled={inactif}
        onChange={(e) => surChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer accent-[hsl(var(--primaire))]"
      />
    </label>
  )
}

/** Un interrupteur avec son libelle et sa note. */
function Bascule({ coche, surChange, nom, note }: { coche: boolean; surChange: (v: boolean) => void; nom: string; note: string }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <span>
        <span className="block text-[12px] text-texte">{nom}</span>
        <span className="block text-[10.5px] leading-relaxed text-attenue-texte">{note}</span>
      </span>
      <Interrupteur checked={coche} onCheckedChange={surChange} aria-label={nom} />
    </div>
  )
}

/**
 * Reduit l'image choisie avant de la garder : une photo de 8 Mo n'a rien a
 * faire dans un reglage. 1920 px de large en JPEG suffisent a un fond d'ecran.
 */
async function reduireImage(fichier: File): Promise<string> {
  const url = URL.createObjectURL(fichier)
  try {
    const img = await new Promise<HTMLImageElement>((ok, ko) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = () => ko(new Error('Image illisible'))
      i.src = url
    })
    for (const [largeur, qualite] of [[1920, 0.82], [1600, 0.75], [1280, 0.7]] as const) {
      const echelle = Math.min(1, largeur / img.naturalWidth)
      const c = document.createElement('canvas')
      c.width = Math.round(img.naturalWidth * echelle)
      c.height = Math.round(img.naturalHeight * echelle)
      c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height)
      const donnees = c.toDataURL('image/jpeg', qualite)
      if (donnees.length < 1_900_000) return donnees
    }
    throw new Error('Image trop lourde, même réduite.')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Les reglages eux-memes, sans le tiroir qui les porte.
 *
 * Le panneau glissant et l'onglet des parametres montrent les memes reglages :
 * les ecrire deux fois garantit qu'ils divergent des la premiere retouche.
 */
export function ControlesApparence() {
  const { theme, definir: definirTheme } = useTheme()
  const ap = useApparence()
  const { charte, densite, taille, disposition, piedVisible, police, palette, cadres, fond, verre, definir, imageFond, definirImageFond } = ap
  const fichier = useRef<HTMLInputElement>(null)
  const [nomImage, setNomImage] = useState<string | null>(null)
  const [erreurImage, setErreurImage] = useState<string | null>(null)

  const charteChoisie = CHARTES.find((x) => x.cle === charte)
  const dispoChoisie = DISPOSITIONS.find((d) => d.cle === disposition)
  const densiteChoisie = DENSITES.find((d) => d.cle === densite)
  const policeChoisie = POLICES.find((p) => p.cle === police)

  const f = (a: Partial<ReglageFond>) => definir({ fond: { ...fond, ...a } })
  const v = (a: Partial<ReglageVerre>) => definir({ verre: { ...verre, ...a } })

  return (
    <>
      {/* --- 1. Style ----------------------------------------------------------- */}
      <Titre num="1">Style</Titre>

      <Ligne pour="ap-charte" nom="Style">
        <Selecteur id="ap-charte" value={charte} onChange={(e) => definir({ charte: e.target.value as Charte })}>
          {CHARTES.map((x) => (
            <option key={x.cle} value={x.cle}>
              {x.nom}
            </option>
          ))}
        </Selecteur>
      </Ligne>
      {charteChoisie && <Note>{charteChoisie.resume}</Note>}

      <Ligne pour="ap-mode" nom="Mode">
        <Selecteur id="ap-mode" value={theme} onChange={(e) => definirTheme(e.target.value as Theme)}>
          {MODES.map((m) => (
            <option key={m.cle} value={m.cle}>
              {m.nom}
            </option>
          ))}
        </Selecteur>
      </Ligne>

      <div className="py-1">
        <span className="mb-1.5 block text-[12px] text-attenue-texte">Palette de couleurs</span>
        {/* Des pastilles plutot qu'une liste : une couleur se choisit en la
            voyant, pas en lisant son nom. */}
        <div className="grid grid-cols-4 gap-1.5">
          {PALETTES.map((p) => (
            <button
              key={p.cle}
              type="button"
              title={p.nom}
              aria-pressed={palette === p.cle}
              onClick={() => definir({ palette: p.cle as Palette })}
              className={cn(
                'flex h-9 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-sm)] border text-[9.5px] transition-colors',
                palette === p.cle ? 'border-primaire bg-primaire/10 text-texte' : 'border-bordure text-attenue-texte hover:border-champ',
              )}
            >
              <span
                className="h-3 w-8 rounded-full"
                style={{
                  background: p.teintes
                    ? `linear-gradient(90deg, ${p.teintes[0]}, ${p.teintes[1]})`
                    : 'repeating-linear-gradient(45deg, hsl(var(--bordure)) 0 3px, transparent 3px 6px)',
                }}
              />
              <span className="max-w-full truncate px-1">{p.cle === 'auto' ? 'Style' : p.nom.split(' ')[0]}</span>
            </button>
          ))}
        </div>
      </div>

      <Ligne pour="ap-cadres" nom="Cadres">
        <Selecteur id="ap-cadres" value={cadres} onChange={(e) => definir({ cadres: e.target.value as Cadres })}>
          {CADRES.map((c) => (
            <option key={c.cle} value={c.cle}>
              {c.nom}
            </option>
          ))}
        </Selecteur>
      </Ligne>
      <Note>Un filet dégradé autour des cartes et des tableaux, ou des filets unis et des boutons pleins.</Note>

      {/* --- 2. Texte ----------------------------------------------------------- */}
      <Titre num="2">Texte</Titre>

      <Ligne pour="ap-police" nom="Police">
        <Selecteur id="ap-police" value={police} onChange={(e) => definir({ police: e.target.value as Police })}>
          {POLICES.map((p) => (
            <option key={p.cle} value={p.cle}>
              {p.nom}
            </option>
          ))}
        </Selecteur>
      </Ligne>

      <Ligne pour="ap-taille" nom="Taille">
        <Selecteur id="ap-taille" value={taille} onChange={(e) => definir({ taille: Number(e.target.value) as Taille })}>
          {TAILLES.map((t) => (
            <option key={t.cle} value={t.cle}>
              {t.nom} — {t.cle} px
            </option>
          ))}
        </Selecteur>
      </Ligne>

      {/* L'echantillon est ecrit DANS la police et A la taille choisies. */}
      <div
        className="mt-1.5 rounded-[var(--radius-sm)] border border-bordure bg-attenue/40 px-2.5 py-2 tabular-nums"
        style={{ fontSize: taille, fontFamily: policeChoisie?.famille }}
      >
        Réf. PP-1500 — 1 048,50 kg — BC-2026-0026
      </div>

      {/* --- 3. Fond ------------------------------------------------------------- */}
      <Titre num="3">Fond</Titre>

      <Bascule
        nom="Régler le fond"
        note={fond.actif ? 'Votre image ou celle du style, avec les réglages ci-dessous.' : 'Le fond propre au style.'}
        coche={fond.actif}
        surChange={(x) => f({ actif: x })}
      />

      <div className={cn(!fond.actif && 'pointer-events-none opacity-40')}>
        <input
          ref={fichier}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const fi = e.target.files?.[0]
            e.target.value = ''
            if (!fi) return
            setErreurImage(null)
            try {
              definirImageFond(await reduireImage(fi))
              setNomImage(fi.name)
            } catch (err) {
              setErreurImage(err instanceof Error ? err.message : 'Image refusée.')
            }
          }}
        />
        <div className="mb-1 flex gap-1.5">
          <Bouton variante="contour" taille="sm" className="flex-1" onClick={() => fichier.current?.click()}>
            <ImagePlus />
            Choisir une image
          </Bouton>
          {imageFond && (
            <Bouton variante="discret" taille="sm" title="Revenir à l'image du style" onClick={() => definirImageFond(null)}>
              <Trash2 />
            </Bouton>
          )}
        </div>
        <p className="mb-2 truncate text-[10.5px] text-attenue-texte">
          {erreurImage ?? (imageFond ? (nomImage ?? 'Votre image') : 'Image du style')}
        </p>

        <Ligne pour="ap-fond-pos" nom="Position">
          <Selecteur id="ap-fond-pos" value={fond.position} onChange={(e) => f({ position: e.target.value })}>
            {POSITIONS_FOND.map((p) => (
              <option key={p.cle} value={p.cle}>
                {p.nom}
              </option>
            ))}
          </Selecteur>
        </Ligne>
        <div className="mt-2">
          <Curseur nom="Zoom" valeur={fond.zoom} unite="%" min={100} max={250} surChange={(x) => f({ zoom: x })} />
          <Curseur nom="Luminosité" valeur={fond.luminosite} unite="%" min={10} max={150} surChange={(x) => f({ luminosite: x })} />
          <Curseur nom="Contraste" valeur={fond.contraste} unite="%" min={50} max={180} surChange={(x) => f({ contraste: x })} />
          <Curseur nom="Saturation" valeur={fond.saturation} unite="%" min={0} max={200} surChange={(x) => f({ saturation: x })} />
          <Curseur nom="Flou du fond" valeur={fond.flou} unite=" px" min={0} max={30} surChange={(x) => f({ flou: x })} />
          <Curseur nom="Voile" valeur={fond.voile} unite="%" min={0} max={90} surChange={(x) => f({ voile: x })} />
        </div>
      </div>

      {/* --- 4. Verre des panneaux --------------------------------------------- */}
      <Titre num="4">Verre des panneaux</Titre>

      <Bascule
        nom="Régler le verre"
        note={verre.actif ? 'Cartes, tableaux, menu et barres suivent les réglages ci-dessous.' : 'Le verre propre au style.'}
        coche={verre.actif}
        surChange={(x) => v({ actif: x })}
      />
      <div className={cn(!verre.actif && 'pointer-events-none opacity-40')}>
        <Ligne pour="ap-verre-type" nom="Type de verre">
          <Selecteur id="ap-verre-type" value={verre.type} disabled={!verre.actif} onChange={(e) => v({ type: e.target.value as TypeVerre })}>
            {TYPES_VERRE.map((t) => (
              <option key={t.cle} value={t.cle}>
                {t.nom}
              </option>
            ))}
          </Selecteur>
        </Ligne>
        <Note>{TYPES_VERRE.find((t) => t.cle === verre.type)?.resume}</Note>
      </div>
      <div className="mt-3" />
      <Curseur inactif={!verre.actif} nom="Opacité" valeur={verre.transparence} unite="%" min={0} max={100} surChange={(x) => v({ transparence: x })} />
      <Curseur inactif={!verre.actif} nom="Flou du verre" valeur={verre.flou} unite=" px" min={0} max={60} surChange={(x) => v({ flou: x })} />
      <Curseur inactif={!verre.actif} nom="Saturation du verre" valeur={verre.saturation} unite="%" min={100} max={300} surChange={(x) => v({ saturation: x })} />
      <Curseur inactif={!verre.actif} nom="Bordure — épaisseur" valeur={verre.bordure} unite=" px" min={0} max={4} pas={0.5} surChange={(x) => v({ bordure: x })} />
      <Curseur inactif={!verre.actif} nom="Bordure — opacité" valeur={verre.bordureOpacite} unite="%" min={0} max={100} surChange={(x) => v({ bordureOpacite: x })} />
      <Curseur inactif={!verre.actif} nom="Rayon des angles" valeur={verre.rayon} unite=" px" min={0} max={40} surChange={(x) => v({ rayon: x })} />

      {/* --- 5. Tableaux --------------------------------------------------------- */}
      <Titre num="5">Tableaux</Titre>

      <Ligne pour="ap-densite" nom="Densité">
        <Selecteur id="ap-densite" value={densite} onChange={(e) => definir({ densite: e.target.value as Densite })}>
          {DENSITES.map((d) => (
            <option key={d.cle} value={d.cle}>
              {d.nom}
            </option>
          ))}
        </Selecteur>
      </Ligne>
      {densiteChoisie && <Note>{densiteChoisie.resume}</Note>}

      {/* --- 6. Fenêtre ---------------------------------------------------------- */}
      <Titre num="6">Fenêtre</Titre>

      <Ligne pour="ap-disposition" nom="Navigation">
        <Selecteur id="ap-disposition" value={disposition} onChange={(e) => definir({ disposition: e.target.value as Disposition })}>
          {DISPOSITIONS.map((d) => (
            <option key={d.cle} value={d.cle}>
              {d.nom}
            </option>
          ))}
        </Selecteur>
      </Ligne>
      {dispoChoisie && <Note>{dispoChoisie.resume}</Note>}

      <div className="mt-2">
        <Bascule
          nom="Barre de pied"
          note="État de la base et exercice courant, en permanence. Coûte une ligne de hauteur."
          coche={piedVisible}
          surChange={(x) => definir({ piedVisible: x })}
        />
      </div>
    </>
  )
}

export function PanneauApparence({ ouvert, surFermeture }: { ouvert: boolean; surFermeture: () => void }) {
  const { reinitialiser } = useApparence()

  // Echap ferme, comme tout tiroir.
  useEffect(() => {
    if (!ouvert) return
    const fe = (e: KeyboardEvent) => e.key === 'Escape' && surFermeture()
    window.addEventListener('keydown', fe)
    return () => window.removeEventListener('keydown', fe)
  }, [ouvert, surFermeture])

  return (
    <>
      {/* Le voile ferme au clic. Il ne floute pas : on veut voir l'effet. */}
      {ouvert && <div onClick={surFermeture} className="sans-impression fixed inset-0 z-40 bg-black/10" aria-hidden />}

      <aside
        aria-label="Apparence"
        aria-hidden={!ouvert}
        className={cn(
          'sans-impression fixed bottom-3 right-3 top-3 z-50 flex w-[20rem] flex-col overflow-hidden rounded-[14px]',
          'border border-bordure bg-surface shadow-2xl backdrop-blur-xl',
          'transition-transform duration-200 ease-out',
          ouvert ? 'translate-x-0' : 'translate-x-[calc(100%+1rem)]',
        )}
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-bordure px-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em]">Réglages</span>
          <button
            type="button"
            onClick={surFermeture}
            title="Fermer (Échap)"
            className="grid size-7 place-items-center rounded-[var(--radius-sm)] text-attenue-texte transition-colors hover:bg-attenue hover:text-texte"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2">
          <ControlesApparence />
        </div>

        <div className="shrink-0 space-y-2 border-t border-bordure px-4 py-3">
          <p className="text-[10.5px] leading-relaxed text-attenue-texte">
            Ces réglages sont gardés sur votre compte : vous les retrouvez à chaque connexion, sur
            n'importe quel poste.
          </p>
          <Bouton variante="contour" className="w-full" onClick={reinitialiser}>
            <RotateCcw />
            Réinitialiser tout
          </Bouton>
        </div>
      </aside>
    </>
  )
}
