/**
 * Les pieces du dossier : scans, PDF, photos.
 *
 * DEUX CHOSES SUR UN MEME ECRAN. Ce qui est la — chaque document, sa nature,
 * qui l'a depose — et CE QUI MANQUE : la liste des pieces attendues se deduit
 * du dossier lui-meme (une facture fournisseur par facture saisie, la quittance
 * et la fiche de liquidation des qu'un frais de douane existe, un justificatif
 * par type de frais). C'est ce que l'assistante cherche dans sa chemise.
 *
 * Le document ne s'ouvre pas par un simple lien : la route exige le jeton. On
 * le telecharge, on l'affiche depuis une adresse locale, et on la revoque.
 */
import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Eye, FileCheck2, FileWarning, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../api/client'
import {
  Badge,
  Bouton,
  Carte,
  CarteCorps,
  CarteEntete,
  CarteTitre,
  Selecteur,
} from '../../composants/ui/base'
import { useConfirmation } from '../../composants/ui/surcouches'
import { cn, fmt } from '../../lib/utils'
import { echec, useRafraichir } from './dialogues'
import { NATURE_PIECE, type DossierComplet, type Piece } from './types'

const th = 'px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte'
const td = 'px-2 py-1.5'

/** « 2,4 Mo », « 812 ko » : un poids se lit, il ne se compte pas en octets. */
const poids = (octets: number) =>
  octets >= 1024 * 1024
    ? `${fmt.nombre(octets / (1024 * 1024), 1)} Mo`
    : `${Math.round(octets / 1024)} ko`

/**
 * Ce que le dossier devrait contenir, deduit de ce qu'il porte deja.
 *
 * On ne reclame que ce qui a une raison d'exister : pas de quittance tant
 * qu'aucun frais de douane n'est saisi, pas de facture fournisseur tant
 * qu'aucune facture ne l'est.
 */
function attendues(d: DossierComplet): { nature: Piece['nature']; libelle: string; combien: number }[] {
  const liste: { nature: Piece['nature']; libelle: string; combien: number }[] = []
  if (d.factures.length > 0) {
    liste.push({
      nature: 'FACTURE_FOURNISSEUR',
      libelle: 'Facture fournisseur',
      combien: d.factures.length,
    })
  }
  const douane = d.frais.some((f) => f.categorie === 'DOUANE' || f.categorie === 'TAXE')
  if (douane) {
    liste.push({ nature: 'QUITTANCE_DOUANE', libelle: 'Quittance de la douane', combien: 1 })
    liste.push({ nature: 'LIQUIDATION', libelle: 'Fiche de liquidation', combien: 1 })
    liste.push({ nature: 'DUM', libelle: 'DUM (déclaration)', combien: 1 })
  }
  if (d.frais.some((f) => f.categorie !== 'DOUANE' && f.categorie !== 'TAXE')) {
    liste.push({
      nature: 'FACTURE_FRAIS',
      libelle: 'Facture de frais (transitaire, fret, port)',
      combien: 1,
    })
  }
  if (d.dossier.numero_bl) liste.push({ nature: 'BL', libelle: 'Connaissement (BL)', combien: 1 })
  return liste
}

export function PiecesDossier({ d, ecrire }: { d: DossierComplet; ecrire: boolean }) {
  const idDossier = d.dossier.id_dossier
  const rafraichir = useRafraichir(idDossier)
  const confirmation = useConfirmation()
  const champFichier = useRef<HTMLInputElement>(null)
  const [nature, setNature] = useState<Piece['nature']>('AUTRE')
  const [survol, setSurvol] = useState(false)

  const deposer = useMutation({
    mutationFn: async (fichiers: File[]) => {
      const resultats: { doublon?: boolean; message?: string }[] = []
      for (const f of fichiers) {
        const donnees = new FormData()
        donnees.append('nature', nature)
        donnees.append('fichier', f)
        resultats.push(
          await api.envoyerFichier<{ doublon?: boolean; message?: string }>(
            `/api/import/dossiers/${idDossier}/pieces`,
            donnees,
          ),
        )
      }
      return resultats
    },
    onSuccess: (resultats) => {
      const doublons = resultats.filter((r) => r.doublon)
      if (doublons.length) toast.warning(doublons[0].message ?? 'Document déjà déposé.')
      const neufs = resultats.length - doublons.length
      if (neufs > 0) toast.success(`${neufs} document(s) déposé(s)`)
      rafraichir()
    },
    onError: echec,
  })

  const supprimer = useMutation({
    mutationFn: (id: string) => api.delete(`/api/import/pieces/${id}`),
    onSuccess: () => {
      toast.success('Pièce retirée')
      rafraichir()
    },
    onError: echec,
  })

  /** Ouvre la piece dans un onglet, puis rend la memoire. */
  const voir = async (piece: Piece) => {
    try {
      const { url } = await api.fichier(`/api/import/pieces/${piece.id_piece}`)
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      echec(e)
    }
  }

  const choisis = (liste: FileList | null) => {
    const fichiers = [...(liste ?? [])]
    if (fichiers.length) deposer.mutate(fichiers)
  }

  const manquantes = attendues(d).filter(
    (a) => d.pieces.filter((p) => p.nature === a.nature).length < a.combien,
  )

  return (
    <Carte>
      <CarteEntete>
        <CarteTitre>Pièces du dossier</CarteTitre>
        <span className="text-[11.5px] text-attenue-texte">
          {d.pieces.length} document(s)
          {manquantes.length > 0 && ` · ${manquantes.length} manquant(s)`}
        </span>
      </CarteEntete>
      <CarteCorps className="space-y-3">
        {/* Ce qui manque, avant ce qui est la : c'est la question qu'on se pose. */}
        {manquantes.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[12px]" data-manquantes>
            <FileWarning className="size-4 text-alerte" />
            <span className="text-attenue-texte">Il manque :</span>
            {manquantes.map((m) => (
              <Badge key={m.nature} ton="alerte">
                {m.libelle}
                {m.combien > 1 && ` (${m.combien})`}
              </Badge>
            ))}
          </div>
        )}

        {ecrire && (
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setSurvol(true)
            }}
            onDragLeave={() => setSurvol(false)}
            onDrop={(e) => {
              e.preventDefault()
              setSurvol(false)
              choisis(e.dataTransfer.files)
            }}
            className={cn(
              'flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-dashed border-bordure p-3',
              survol && 'border-primaire bg-primaire/5',
            )}
          >
            <Selecteur
              className="h-8 w-56"
              aria-label="Nature du document"
              value={nature}
              onChange={(e) => setNature(e.target.value as Piece['nature'])}
            >
              {Object.entries(NATURE_PIECE).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Selecteur>
            <Bouton
              taille="sm"
              variante="contour"
              chargement={deposer.isPending}
              onClick={() => champFichier.current?.click()}
            >
              <Upload />
              Choisir des fichiers
            </Bouton>
            <span className="text-[11.5px] text-attenue-texte">
              ou déposez-les ici — PDF, JPEG, PNG ou TIFF, 40 Mo au plus
            </span>
            <input
              ref={champFichier}
              type="file"
              multiple
              hidden
              accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,.webp,application/pdf,image/*"
              onChange={(e) => {
                choisis(e.target.files)
                e.target.value = ''
              }}
            />
          </div>
        )}

        {d.pieces.length === 0 ? (
          <p className="text-[12.5px] text-attenue-texte">
            Aucune pièce. Déposez ici le scan du dossier : facture, DUM, quittance, factures de frais.
          </p>
        ) : (
          <div className="defilement-x">
            <table className="w-full min-w-[48rem] text-[12.5px]">
              <thead>
                <tr className="border-b border-bordure">
                  <th className={cn(th, 'text-left')}>Document</th>
                  <th className={cn(th, 'w-52 text-left')}>Nature</th>
                  <th className={cn(th, 'w-24 text-right')}>Taille</th>
                  <th className={cn(th, 'w-32 text-left')}>Déposé le</th>
                  <th className={cn(th, 'w-28 text-left')}>Par</th>
                  <th className={cn(th, 'w-24')} />
                </tr>
              </thead>
              <tbody>
                {d.pieces.map((p) => (
                  <tr key={p.id_piece} className="border-b border-bordure/60">
                    <td className={cn(td, 'font-medium')}>
                      {p.nom_fichier}
                      {p.numero_facture && (
                        <div className="text-[11px] font-normal text-attenue-texte">
                          {p.numero_facture}
                        </div>
                      )}
                    </td>
                    <td className={td}>
                      <span className="inline-flex items-center gap-1.5">
                        <FileCheck2 className="size-3.5 text-attenue-texte" />
                        {NATURE_PIECE[p.nature]}
                      </span>
                    </td>
                    <td className={cn(td, 'text-right tabular-nums')}>{poids(p.taille_octets)}</td>
                    <td className={td}>{fmt.date(p.date_depot)}</td>
                    <td className={cn(td, 'text-attenue-texte')}>{p.depose_par ?? '—'}</td>
                    <td className={td}>
                      <div className="flex justify-end gap-0.5">
                        <Bouton
                          taille="icone-xs"
                          variante="discret"
                          title="Voir le document"
                          aria-label="Voir le document"
                          onClick={() => voir(p)}
                        >
                          <Eye />
                        </Bouton>
                        {ecrire && (
                          <Bouton
                            taille="icone-xs"
                            variante="discret"
                            className="text-danger hover:bg-danger/10"
                            aria-label="Retirer la pièce"
                            onClick={() =>
                              confirmation.demander({
                                titre: `Retirer « ${p.nom_fichier} » ?`,
                                destructif: true,
                                libelleConfirmer: 'Retirer',
                                description: 'Le document sera effacé du serveur.',
                                action: () => supprimer.mutate(p.id_piece),
                              })
                            }
                          >
                            <Trash2 />
                          </Bouton>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CarteCorps>
    </Carte>
  )
}
