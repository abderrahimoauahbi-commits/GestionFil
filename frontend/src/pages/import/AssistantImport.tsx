/**
 * L'ASSISTANT D'IMPORTATION — on part du scan, pas du formulaire vide.
 *
 * Le geste réel est celui-ci : le transitaire envoie une liasse, on la passe au
 * scanner, et il faut en tirer un dossier. L'écran suit donc cet ordre —
 * d'abord les documents, ensuite les informations, le scan restant visible
 * pendant qu'on les recopie.
 *
 * IL NE LIT PAS LES DOCUMENTS. Aucun OCR n'est installé, et prétendre lire un
 * numéro de facture pour se tromper d'un chiffre coûterait plus cher que de le
 * taper. Ce qu'il fait, lui, personne ne le fait à sa place : garder la page
 * sous les yeux pendant la saisie, dire ce qui manque encore, et enchaîner les
 * étapes sans qu'on ait à savoir quel écran ouvrir.
 *
 * LES FICHIERS NE PARTENT QU'À LA CRÉATION. Tant que le dossier n'existe pas,
 * ils restent dans le navigateur : un dossier à moitié créé parce qu'on a
 * abandonné en cours de route ne laisse rien derrière lui.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  FolderOpen,
  Trash2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../../api/client'
import { EnTetePage } from '../../composants/Coquille'
import { useOuvrirVue } from '../../lib/navigation'
import {
  Alerte,
  Badge,
  Bouton,
  Carte,
  CarteCorps,
  CarteEntete,
  CarteTitre,
  Champ,
  Etiq,
  Selecteur,
} from '../../composants/ui/base'
import { cn } from '../../lib/utils'
import { NATURE_PIECE, type Piece } from './types'

/** Un document en attente : le fichier, sa nature, et de quoi l'afficher. */
interface Document {
  fichier: File
  nature: Piece['nature']
  apercu: string
}

const ETAPES = [
  { cle: 'documents', titre: 'Les documents', detail: 'Chargez la liasse scannée' },
  { cle: 'dossier', titre: 'Le dossier', detail: 'Recopiez les informations, scan sous les yeux' },
  { cle: 'suite', titre: 'Factures et frais', detail: 'La saisie continue dans le dossier' },
] as const

export function AssistantImport() {
  const ouvrir = useOuvrirVue()
  const qc = useQueryClient()
  const champFichier = useRef<HTMLInputElement>(null)
  const [etape, setEtape] = useState(0)
  const [documents, setDocuments] = useState<Document[]>([])
  const [pointe, setPointe] = useState(0)
  const [survol, setSurvol] = useState(false)
  const [f, setF] = useState({
    numero: '',
    numero_bl: '',
    conteneurs: '',
    code_devise: 'USD',
    taux_change: '',
    date_arrivee: '',
    notes: '',
  })

  const qDevises = useQuery({
    queryKey: ['devises'],
    queryFn: () => api.get<{ code_devise: string }[]>('/api/devises'),
  })

  // Les aperçus tiennent de la mémoire tant que l'onglet vit : on la rend dès
  // qu'un document sort de la liste.
  useEffect(() => {
    return () => documents.forEach((d) => URL.revokeObjectURL(d.apercu))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ajouter = (liste: FileList | null) => {
    const neufs = [...(liste ?? [])].map((fichier) => ({
      fichier,
      // La nature se devine par le nom du fichier quand le scanner le nomme :
      // « facture-hasirci.pdf » n'a pas besoin d'être classé à la main.
      nature: natureProbable(fichier.name),
      apercu: URL.createObjectURL(fichier),
    }))
    if (neufs.length === 0) return
    setDocuments((d) => [...d, ...neufs])
  }

  const retirer = (i: number) =>
    setDocuments((d) => {
      URL.revokeObjectURL(d[i].apercu)
      const reste = d.filter((_, j) => j !== i)
      setPointe((p) => Math.min(p, Math.max(0, reste.length - 1)))
      return reste
    })

  const creer = useMutation({
    mutationFn: async () => {
      const dossier = await api.post<{ id_dossier: string; numero: string }>(
        '/api/import/dossiers',
        {
          numero: f.numero.trim() || null,
          numero_bl: f.numero_bl.trim() || null,
          conteneurs: f.conteneurs.trim() || null,
          code_devise: f.code_devise,
          taux_change: Number(f.taux_change.replace(',', '.')),
          date_arrivee: f.date_arrivee || null,
          notes: f.notes.trim() || null,
        },
      )
      // Le dossier existe : les documents peuvent le rejoindre. Un envoi qui
      // échoue ne défait pas le dossier — on le dit, et il reste à charger.
      let deposes = 0
      const refuses: string[] = []
      for (const d of documents) {
        const donnees = new FormData()
        donnees.append('nature', d.nature)
        donnees.append('fichier', d.fichier)
        try {
          const r = await api.envoyerFichier<{ doublon?: boolean }>(
            `/api/import/dossiers/${dossier.id_dossier}/pieces`,
            donnees,
          )
          if (!r.doublon) deposes += 1
        } catch {
          refuses.push(d.fichier.name)
        }
      }
      return { dossier, deposes, refuses }
    },
    onSuccess: ({ dossier, deposes, refuses }) => {
      toast.success(`Dossier ${dossier.numero} créé — ${deposes} document(s) déposé(s)`)
      if (refuses.length) toast.warning(`Non déposé(s) : ${refuses.join(', ')}`)
      void qc.invalidateQueries({ queryKey: ['import-dossiers'] })
      ouvrir(`/import/${dossier.id_dossier}`)
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : 'Création impossible.'),
  })

  const maj = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value }))

  const tauxValide = Number(f.taux_change.replace(',', '.')) > 0
  const doc = documents[pointe]

  const manquants = useMemo(() => {
    const natures = new Set(documents.map((d) => d.nature))
    const attendus: [Piece['nature'], string][] = [
      ['FACTURE_FOURNISSEUR', 'la facture du fournisseur'],
      ['BL', 'le connaissement (BL)'],
      ['PACKING', 'la liste de colisage'],
    ]
    return attendus.filter(([n]) => !natures.has(n)).map(([, libelle]) => libelle)
  }, [documents])

  return (
    <>
      <EnTetePage
        titre="Assistant d'importation"
        description="Chargez la liasse scannée : le dossier se crée autour d'elle."
      />

      {/* LE CHEMIN, TOUJOURS VISIBLE. On doit pouvoir dire où l'on en est et ce
          qui reste — c'est ce qui distingue un assistant d'un formulaire. */}
      <ol className="mb-3 flex flex-wrap gap-2 text-[12px]">
        {ETAPES.map((e, i) => (
          <li
            key={e.cle}
            className={cn(
              'flex items-center gap-2 rounded-[var(--radius)] border px-3 py-1.5',
              i === etape
                ? 'border-primaire bg-primaire/5 text-texte'
                : 'border-bordure text-attenue-texte',
            )}
          >
            <span
              className={cn(
                'grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold',
                i < etape ? 'bg-succes text-white' : i === etape ? 'bg-primaire text-white' : 'bg-attenue',
              )}
            >
              {i < etape ? <Check className="size-3" /> : i + 1}
            </span>
            <span>
              <span className="font-medium">{e.titre}</span>
              <span className="ml-1.5 hidden text-attenue-texte sm:inline">{e.detail}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className={cn('grid gap-3', etape === 1 && documents.length > 0 ? 'lg:grid-cols-2' : '')}>
        {/* ------------------------------------------------ ÉTAPE 1 : les scans */}
        {etape === 0 && (
          <Carte>
            <CarteEntete>
              <CarteTitre>Les documents du dossier</CarteTitre>
              <span className="text-[11.5px] text-attenue-texte">
                {documents.length} document(s)
              </span>
            </CarteEntete>
            <CarteCorps className="space-y-3">
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setSurvol(true)
                }}
                onDragLeave={() => setSurvol(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setSurvol(false)
                  ajouter(e.dataTransfer.files)
                }}
                className={cn(
                  'rounded-[var(--radius)] border-2 border-dashed px-4 py-8 text-center transition-colors',
                  survol ? 'border-primaire bg-primaire/5' : 'border-bordure',
                )}
              >
                <Upload className="mx-auto mb-2 size-6 text-attenue-texte" />
                <div className="text-[13px] font-medium">
                  Glissez ici le PDF sorti du scanner
                </div>
                <div className="mb-3 text-[11.5px] text-attenue-texte">
                  Plusieurs fichiers acceptés — PDF, JPG, PNG
                </div>
                <Bouton taille="sm" variante="contour" onClick={() => champFichier.current?.click()}>
                  <FolderOpen className="mr-1 size-3.5" />
                  Parcourir
                </Bouton>
                <input
                  ref={champFichier}
                  type="file"
                  multiple
                  accept=".pdf,image/*"
                  className="hidden"
                  onChange={(e) => {
                    ajouter(e.target.files)
                    e.target.value = ''
                  }}
                />
              </div>

              {documents.length > 0 && (
                <ul className="divide-y divide-bordure/60 rounded-[var(--radius)] border border-bordure">
                  {documents.map((d, i) => (
                    <li key={i} className="flex items-center gap-2 px-3 py-2">
                      <FileText className="size-4 shrink-0 text-attenue-texte" />
                      <span className="min-w-0 flex-1 truncate text-[12.5px]">{d.fichier.name}</span>
                      <Selecteur
                        value={d.nature}
                        onChange={(e) =>
                          setDocuments((x) =>
                            x.map((y, j) =>
                              j === i ? { ...y, nature: e.target.value as Piece['nature'] } : y,
                            ),
                          )
                        }
                        className="h-7 w-52 text-[12px]"
                      >
                        {Object.entries(NATURE_PIECE).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </Selecteur>
                      <button
                        type="button"
                        onClick={() => retirer(i)}
                        aria-label="Retirer"
                        className="rounded p-1 text-attenue-texte hover:bg-attenue hover:text-danger"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* CE QUI MANQUE, DIT MAINTENANT — pas au moment de clôturer, quand
                  il faudra redemander la pièce au transitaire. */}
              {documents.length > 0 && manquants.length > 0 && (
                <Alerte ton="alerte">
                  Il manque sans doute {manquants.join(', ')}. Vous pouvez continuer et les
                  charger plus tard : le dossier vous les redemandera.
                </Alerte>
              )}

              <div className="flex justify-end gap-2">
                <Bouton variante="contour" onClick={() => ouvrir('/import')}>
                  Annuler
                </Bouton>
                <Bouton onClick={() => setEtape(1)} disabled={documents.length === 0}>
                  Continuer
                  <ArrowRight className="ml-1 size-3.5" />
                </Bouton>
              </div>
            </CarteCorps>
          </Carte>
        )}

        {/* ------------------------------------- ÉTAPE 2 : le dossier, scan à côté */}
        {etape === 1 && (
          <>
            <Carte>
              <CarteEntete>
                <CarteTitre>Les informations du dossier</CarteTitre>
              </CarteEntete>
              <CarteCorps className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Etiq>Numéro</Etiq>
                    <Champ
                      value={f.numero}
                      onChange={maj('numero')}
                      placeholder="laissez vide : 56/26"
                    />
                  </div>
                  <div>
                    <Etiq>Connaissement (BL)</Etiq>
                    <Champ value={f.numero_bl} onChange={maj('numero_bl')} placeholder="ISB2023278" />
                  </div>
                  <div>
                    <Etiq>Conteneurs</Etiq>
                    <Champ
                      value={f.conteneurs}
                      onChange={maj('conteneurs')}
                      placeholder="CMAU4385688"
                    />
                  </div>
                  <div>
                    <Etiq>Date d'arrivée</Etiq>
                    <Champ type="date" value={f.date_arrivee} onChange={maj('date_arrivee')} />
                  </div>
                  <div>
                    <Etiq>Devise</Etiq>
                    <Selecteur value={f.code_devise} onChange={maj('code_devise')}>
                      {(qDevises.data ?? [{ code_devise: 'USD' }]).map((d) => (
                        <option key={d.code_devise} value={d.code_devise}>
                          {d.code_devise}
                        </option>
                      ))}
                    </Selecteur>
                  </div>
                  <div>
                    <Etiq>Taux de change</Etiq>
                    <Champ
                      value={f.taux_change}
                      onChange={maj('taux_change')}
                      placeholder="9,2224"
                      inputMode="decimal"
                    />
                  </div>
                </div>
                <div>
                  <Etiq>Notes</Etiq>
                  <Champ value={f.notes} onChange={maj('notes')} />
                </div>

                {!tauxValide && (
                  <Alerte ton="info">
                    Le taux de change est obligatoire : c'est lui qui convertit toutes les
                    factures du dossier en dirhams.
                  </Alerte>
                )}

                <div className="flex justify-between gap-2">
                  <Bouton variante="contour" onClick={() => setEtape(0)}>
                    <ArrowLeft className="mr-1 size-3.5" />
                    Les documents
                  </Bouton>
                  <Bouton
                    onClick={() => creer.mutate()}
                    disabled={!tauxValide || creer.isPending}
                    chargement={creer.isPending}
                  >
                    Créer le dossier et déposer les {documents.length} document(s)
                  </Bouton>
                </div>
              </CarteCorps>
            </Carte>

            {/* LE SCAN SOUS LES YEUX. C'est tout le service rendu : on recopie
                sans changer de fenêtre ni imprimer la liasse. */}
            {doc && (
              <Carte>
                <CarteEntete>
                  <CarteTitre>{doc.fichier.name}</CarteTitre>
                  <div className="flex items-center gap-1.5">
                    <Badge ton="neutre">{NATURE_PIECE[doc.nature]}</Badge>
                    {documents.length > 1 && (
                      <Selecteur
                        value={String(pointe)}
                        onChange={(e) => setPointe(Number(e.target.value))}
                        className="h-7 w-40 text-[12px]"
                      >
                        {documents.map((d, i) => (
                          <option key={i} value={i}>
                            {d.fichier.name}
                          </option>
                        ))}
                      </Selecteur>
                    )}
                  </div>
                </CarteEntete>
                <CarteCorps>
                  {doc.fichier.type.startsWith('image/') ? (
                    <img
                      src={doc.apercu}
                      alt={doc.fichier.name}
                      className="max-h-[70vh] w-full rounded border border-bordure object-contain"
                    />
                  ) : (
                    <iframe
                      src={doc.apercu}
                      title={doc.fichier.name}
                      className="h-[70vh] w-full rounded border border-bordure"
                    />
                  )}
                </CarteCorps>
              </Carte>
            )}
          </>
        )}
      </div>
    </>
  )
}

/**
 * La nature probable d'un document, lue dans son nom de fichier.
 *
 * Ce n'est qu'une proposition — la liste reste modifiable à côté. Un scanner
 * qui nomme « scan0001.pdf » ne dit rien, et c'est très bien : on ne classe
 * alors rien à la place de l'utilisateur.
 */
function natureProbable(nom: string): Piece['nature'] {
  const n = nom.toLowerCase()
  // UNE LIASSE N'EST PAS UNE PIECE. « Dossier transitair.pdf » contient tout le
  // dossier ; le classer en facture de frais parce qu'on y lit « transit »
  // serait une erreur affichee comme une certitude.
  if (n.includes('dossier') || n.includes('liasse')) return 'AUTRE'
  if (n.includes('packing') || n.includes('colisage')) return 'PACKING'
  if (n.includes('dum')) return 'DUM'
  if (n.includes('quittance')) return 'QUITTANCE_DOUANE'
  if (n.includes('liquidation')) return 'LIQUIDATION'
  if (n.includes('bl') || n.includes('connaissement')) return 'BL'
  if (n.includes('engagement')) return 'ENGAGEMENT'
  if (n.includes('transit') || n.includes('fret') || n.includes('frais')) return 'FACTURE_FRAIS'
  if (n.includes('facture') || n.includes('invoice')) return 'FACTURE_FOURNISSEUR'
  return 'AUTRE'
}
