/**
 * L'apparence dans les parametres.
 *
 * ELLE MONTRE LES MEMES REGLAGES QUE LE TIROIR, et par le meme composant : deux
 * copies des memes selecteurs divergent des la premiere retouche, et
 * l'utilisateur decouvre alors que le reglage n'est pas au meme endroit selon
 * la porte par laquelle il est entre.
 *
 * LE TIROIR RESTE LE BON ENDROIT pour choisir : il laisse le tableau visible
 * pendant qu'on regle sa couleur, ce qu'une page ne peut pas faire. Cet onglet
 * existe pour qui cherche le reglage la ou se rangent tous les autres, et le
 * dit.
 */
import { PanelRight, RotateCcw } from 'lucide-react'
import { ControlesApparence } from './PanneauApparence'
import { useApparence } from './Apparence'
import { Bouton, Carte, CarteCorps } from './ui/base'

export function ReglageApparence() {
  const { reinitialiser } = useApparence()

  return (
    <div className="max-w-md space-y-3">
      <Carte>
        <CarteCorps className="pt-4">
          <ControlesApparence />
        </CarteCorps>
      </Carte>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] text-attenue-texte">
          <PanelRight className="size-3.5 shrink-0" />
          Les memes reglages s ouvrent en tiroir depuis l icone de la barre du haut, sans quitter
          l ecran ou l on travaille.
        </p>
        <Bouton variante="contour" onClick={reinitialiser}>
          <RotateCcw />
          Valeurs par defaut
        </Bouton>
      </div>

      <p className="text-[11px] leading-relaxed text-attenue-texte">
        Ces reglages sont gardes dans ce navigateur, sur ce poste. Deux personnes qui partagent un
        compte sur deux machines gardent chacune le sien.
      </p>
    </div>
  )
}
