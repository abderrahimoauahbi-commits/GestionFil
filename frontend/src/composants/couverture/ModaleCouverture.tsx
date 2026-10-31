/**
 * LA GRANDE FENÊTRE DU DÉTAIL (décision du 27/10/2026) : un clic sur une ligne
 * du moteur de couverture — onglet « À commander » du plan d'achat, onglets du
 * stock projeté — ouvre le détail de la référence dans une fenêtre modale
 * large (Radix Dialog : Échap ferme, le focus revient à la ligne), qui défile
 * en hauteur à l'intérieur. Le titre : la référence et sa désignation.
 * Au téléphone, la fenêtre prend tout l'écran (feuille qui remonte du bas).
 */
import { Dialogue, DialogueContenu } from '../ui/surcouches'
import { DetailReference } from './DetailCouverture'
import { designationUtile } from './types'

export function ModaleReference({
  reference,
  designation,
  surFermer,
  enrichi = false,
  rattrapage = null,
  restes = null,
  surSimuler,
}: {
  /** La référence ouverte ; null : fenêtre fermée. */
  reference: string | null
  designation?: string | null
  surFermer: () => void
  /** Le détail enrichi du stock projeté. */
  enrichi?: boolean
  /** L'option de rattrapage du stock projeté pour cette ligne (§ 16). */
  rattrapage?: boolean | null
  /** Les restes comptés ou non (31/10/2026) ; `null` : le réglage. */
  restes?: boolean | null
  surSimuler?: (reference: string) => void
}) {
  const suite = reference ? designationUtile({ code_reference: reference, designation }) : null
  return (
    <Dialogue open={!!reference} onOpenChange={(o) => !o && surFermer()}>
      {reference && (
        <DialogueContenu
          titre={suite ? `${reference} — ${suite}` : reference}
          description={enrichi ? 'Stock projeté — combien commander' : 'Couverture du plan — le moteur de couverture'}
          className="h-[92vh] max-w-[min(76rem,calc(100%-2rem))] max-sm:h-[96vh]"
        >
          <DetailReference
            reference={reference}
            enrichi={enrichi}
            rattrapage={rattrapage}
            restes={restes}
            surSimuler={
              surSimuler
                ? (r) => {
                    surFermer()
                    surSimuler(r)
                  }
                : undefined
            }
          />
        </DialogueContenu>
      )}
    </Dialogue>
  )
}
