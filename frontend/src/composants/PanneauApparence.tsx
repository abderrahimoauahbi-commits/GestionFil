/**
 * Le panneau d'apparence, glissant depuis la droite.
 *
 * POURQUOI UN PANNEAU ET NON UNE PAGE. On regle une couleur en la comparant a
 * ce qu'on regardait : une page de reglages remplace l'ecran, donc oblige a
 * memoriser, changer, revenir, juger. Le panneau laisse le tableau visible a
 * gauche — le changement se voit pendant qu'on le fait.
 *
 * A DROITE, ET PAS A GAUCHE. La navigation occupe deja le bord gauche. Deux
 * tiroirs du meme cote se recouvriraient, et l'un fermerait l'autre.
 *
 * DES SELECTEURS, PAS DES GRILLES DE VIGNETTES. Neuf familles de couleurs et
 * cinq polices en cartes remplissaient le panneau sur trois ecrans de
 * defilement : on ne comparait plus rien, on cherchait. Un selecteur tient sur
 * une ligne, montre la valeur courante sans la deviner, s'ouvre au clavier et
 * se manipule au doigt sur tablette avec la liste du systeme. L'APERCU RESTE,
 * mais sous le selecteur, comme consequence du choix, au lieu de tenir lieu de
 * choix.
 *
 * AUCUN BOUTON DE VALIDATION. Chaque reglage s'applique et se garde. Un panneau
 * de preferences qui demande de valider fait douter qu'on ait bien choisi ; ici
 * l'effet EST la confirmation.
 */
import { useEffect } from 'react'
import { RotateCcw, X } from 'lucide-react'
import {
  DENSITES,
  DISPOSITIONS,
  PALETTES,
  POLICES,
  TAILLES,
  useApparence,
  type Densite,
  type Disposition,
  type Palette,
  type Police,
  type Taille,
} from './Apparence'
import { useTheme, type Theme } from './Theme'
import { Bouton, Selecteur } from './ui/base'
import { cn } from '../lib/utils'

const MODES: { cle: Theme; nom: string }[] = [
  { cle: 'clair', nom: 'Clair' },
  { cle: 'sombre', nom: 'Sombre' },
  { cle: 'systeme', nom: 'Suivre le systeme' },
]

/** Les trois familles ajoutees pour l'aspect, separees des six familles de
 *  travail : le regroupement evite de choisir un fond translucide en croyant
 *  prendre un gris sobre. */
const MODERNES: Palette[] = ['glassier', 'claude', 'azur']

/** Un titre de section. */
function Titre({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 mt-5 text-[10px] font-semibold uppercase tracking-wider text-attenue-texte first:mt-0">
      {children}
    </h3>
  )
}

/** Une ligne de reglage : etiquette a gauche, selecteur a droite, largeurs
 *  alignees d'une ligne a l'autre pour que la colonne des valeurs se lise
 *  verticalement. */
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

/**
 * Les reglages eux-memes, sans le tiroir qui les porte.
 *
 * Le panneau glissant et l'onglet des parametres montrent les memes reglages :
 * les ecrire deux fois garantit qu'ils divergent des la premiere retouche.
 */
export function ControlesApparence() {
  const { theme, definir: definirTheme } = useTheme()
  const {
    palette,
    densite,
    police,
    taille,
    disposition,
    piedVisible,
    menuFige,
    definir,
  } = useApparence()

  const paletteChoisie = PALETTES.find((p) => p.cle === palette)
  const policeChoisie = POLICES.find((p) => p.cle === police)
  const dispoChoisie = DISPOSITIONS.find((d) => d.cle === disposition)
  const densiteChoisie = DENSITES.find((d) => d.cle === densite)

  const sobres = PALETTES.filter((p) => !MODERNES.includes(p.cle))
  const modernes = PALETTES.filter((p) => MODERNES.includes(p.cle))

  return (
    <>
      {/* --- Couleurs ---------------------------------------------------- */}
      <Titre>Couleurs</Titre>

      <Ligne pour="ap-mode" nom="Mode">
        <Selecteur
          id="ap-mode"
          value={theme}
          onChange={(e) => definirTheme(e.target.value as Theme)}
        >
          {MODES.map((m) => (
            <option key={m.cle} value={m.cle}>
              {m.nom}
            </option>
          ))}
        </Selecteur>
      </Ligne>

      <Ligne pour="ap-palette" nom="Famille">
        <Selecteur
          id="ap-palette"
          value={palette}
          onChange={(e) => definir({ palette: e.target.value as Palette })}
        >
          <optgroup label="Sobres">
            {sobres.map((p) => (
              <option key={p.cle} value={p.cle}>
                {p.nom}
              </option>
            ))}
          </optgroup>
          <optgroup label="Modernes">
            {modernes.map((p) => (
              <option key={p.cle} value={p.cle}>
                {p.nom}
              </option>
            ))}
          </optgroup>
        </Selecteur>
      </Ligne>

      {/* L'apercu suit le choix au lieu de le porter : fond, accent, texte,
          les trois couleurs qui decident de la lisibilite d'un tableau. */}
      {paletteChoisie && (
        <div className="mt-1 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
          <span className="flex h-4 self-start overflow-hidden rounded-[3px] border border-bordure">
            {paletteChoisie.teintes.map((t) => (
              <span key={t} className="w-5" style={{ background: t }} />
            ))}
          </span>
          <p className="text-[10.5px] leading-relaxed text-attenue-texte">
            {paletteChoisie.resume}
          </p>
        </div>
      )}

      {/* --- Texte -------------------------------------------------------- */}
      <Titre>Texte</Titre>

      <Ligne pour="ap-police" nom="Police">
        <Selecteur
          id="ap-police"
          value={police}
          onChange={(e) => definir({ police: e.target.value as Police })}
          style={{ fontFamily: policeChoisie?.pile }}
        >
          {POLICES.map((p) => (
            <option key={p.cle} value={p.cle} style={{ fontFamily: p.pile }}>
              {p.nom}
            </option>
          ))}
        </Selecteur>
      </Ligne>

      <Ligne pour="ap-taille" nom="Taille">
        <Selecteur
          id="ap-taille"
          value={taille}
          onChange={(e) => definir({ taille: Number(e.target.value) as Taille })}
        >
          {TAILLES.map((t) => (
            <option key={t.cle} value={t.cle}>
              {t.nom} — {t.cle} px
            </option>
          ))}
        </Selecteur>
      </Ligne>

      {/* L'echantillon est ecrit DANS la police et A la taille choisies : on
          juge un caractere sur des chiffres alignes et un zero, pas sur son
          nom. */}
      <div
        className="mt-1.5 rounded-[var(--radius-sm)] border border-bordure bg-attenue/40 px-2.5 py-2 tabular-nums"
        style={{ fontFamily: policeChoisie?.pile, fontSize: taille }}
      >
        Ref. PP-1500 — 1 048,50 kg — 0 O
      </div>
      {policeChoisie && <Note>{policeChoisie.resume}</Note>}

      {/* --- Tableaux ------------------------------------------------------ */}
      <Titre>Tableaux</Titre>

      <Ligne pour="ap-densite" nom="Densite">
        <Selecteur
          id="ap-densite"
          value={densite}
          onChange={(e) => definir({ densite: e.target.value as Densite })}
        >
          {DENSITES.map((d) => (
            <option key={d.cle} value={d.cle}>
              {d.nom}
            </option>
          ))}
        </Selecteur>
      </Ligne>

      {/* Trois traits a la hauteur du reglage : la densite est une hauteur
          de ligne, elle se montre mieux qu'elle ne se decrit. */}
      <div className="mt-1.5 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
        <div className="space-y-[3px] self-start">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-[1px] bg-attenue"
              style={{ height: densite === 'compacte' ? 3 : densite === 'normale' ? 5 : 8 }}
            />
          ))}
        </div>
        <p className="text-[10.5px] leading-relaxed text-attenue-texte">
          {densiteChoisie?.resume}
        </p>
      </div>

      {/* --- Fenetre ------------------------------------------------------- */}
      <Titre>Fenetre</Titre>

      <Ligne pour="ap-disposition" nom="Navigation">
        <Selecteur
          id="ap-disposition"
          value={disposition}
          onChange={(e) => definir({ disposition: e.target.value as Disposition })}
        >
          {DISPOSITIONS.map((d) => (
            <option key={d.cle} value={d.cle}>
              {d.nom}
            </option>
          ))}
        </Selecteur>
      </Ligne>
      {dispoChoisie && <Note>{dispoChoisie.resume}</Note>}

      <div className="mt-2 space-y-1.5">
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={menuFige}
            disabled={disposition === 'entete'}
            onChange={(e) => definir({ menuFige: e.target.checked })}
            className="mt-[3px] size-3.5 shrink-0 disabled:opacity-40"
          />
          <span>
            <span className="text-[12px]">Garder le menu ouvert</span>
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-attenue-texte">
              {disposition === 'entete'
                ? 'Sans objet : la navigation est en haut.'
                : 'Repliee, la barre occupe 56 px et se deploie au survol par-dessus le contenu. Figee, elle reste ouverte et pousse le contenu.'}
            </p>
          </span>
        </label>

        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={piedVisible}
            onChange={(e) => definir({ piedVisible: e.target.checked })}
            className="mt-[3px] size-3.5 shrink-0"
          />
          <span>
            <span className="text-[12px]">Barre de pied</span>
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-attenue-texte">
              Etat de la base et exercice courant, en permanence. Coute une ligne de hauteur
              au tableau.
            </p>
          </span>
        </label>
      </div>
    </>
  )
}

export function PanneauApparence({
  ouvert,
  surFermeture,
}: {
  ouvert: boolean
  surFermeture: () => void
}) {
  const { reinitialiser } = useApparence()

  // Echap ferme, comme tout tiroir. Sans cela, il faut viser une croix de
  // seize pixels pour revenir a son travail.
  useEffect(() => {
    if (!ouvert) return
    const f = (e: KeyboardEvent) => e.key === 'Escape' && surFermeture()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [ouvert, surFermeture])

  return (
    <>
      {/* Le voile : il ferme au clic et signale que le panneau attend. Il ne
          floute pas — on veut justement continuer de voir le tableau. */}
      {ouvert && (
        <div
          onClick={surFermeture}
          className="sans-impression fixed inset-0 z-40 bg-black/20"
          aria-hidden
        />
      )}

      <aside
        aria-label="Apparence"
        aria-hidden={!ouvert}
        className={cn(
          'sans-impression fixed bottom-0 right-0 top-0 z-50 flex w-[19rem] flex-col',
          'border-l border-bordure bg-surface shadow-2xl',
          'transition-transform duration-200 ease-out',
          ouvert ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* --- Entete --------------------------------------------------------- */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-bordure px-4">
          <span className="text-[13px] font-semibold">Apparence</span>
          <button
            type="button"
            onClick={surFermeture}
            title="Fermer (Echap)"
            className="grid size-7 place-items-center rounded-[var(--radius-sm)] text-attenue-texte transition-colors hover:bg-attenue hover:text-texte"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <ControlesApparence />
        </div>

        {/* --- Pied ------------------------------------------------------------ */}
        <div className="shrink-0 space-y-2 border-t border-bordure px-4 py-3">
          <p className="text-[10.5px] leading-relaxed text-attenue-texte">
            Ces reglages sont gardes dans ce navigateur, sur ce poste. Deux personnes qui
            partagent un compte sur deux machines gardent chacune le sien.
          </p>
          <Bouton variante="contour" className="w-full" onClick={reinitialiser}>
            <RotateCcw />
            Valeurs par defaut
          </Bouton>
        </div>
      </aside>
    </>
  )
}
