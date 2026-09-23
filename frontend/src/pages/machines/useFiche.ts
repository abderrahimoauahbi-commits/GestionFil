/**
 * L'etat d'une fiche en cours de saisie.
 *
 * PARTAGE PAR LES DEUX INTERFACES. Le bureau montre une grille, le telephone
 * montre une ligne a la fois — mais la machine a etats est la meme, et c'est
 * elle qui garantit qu'un chargement saisi au telephone donne exactement le
 * meme resultat que le meme chargement saisi au bureau.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  corpsFiche, depuisEtat, etatKg, machinesApi,
  type LigneSaisie, type TypeFiche, type Zone,
} from './noyau'

const aujourdHui = () => new Date().toISOString().slice(0, 10)

/**
 * LES BOBINES QUI MONTENT OCCUPENT DES PLACES, CELLES QUI DESCENDENT EN LIBERENT.
 *
 * C'est ce qui manquait. Le magasinier qui etend un etage de 1300 a 1344 places
 * et y monte 100 bobines ne va pas retaper « 1344 » ligne par ligne : il dit ce
 * qu'il a monte, et la zone se remplit toute seule. Le calcul est celui de
 * l'atelier, en deux temps :
 *
 *   1. une bobine chargee prend une place — la ligne vise `avant + chargees` ;
 *   2. si le total depasse l'entete, l'exces n'est pas une faute : ce sont les
 *      places LIBEREES depuis le dernier constat, par des bobines filees
 *      jusqu'au tube et retirees. On les retranche au prorata de ce qui a ete
 *      charge, parce qu'on recharge la ou les places se liberent.
 *
 * L'exemple qui posait probleme : 1300 avant, 1344 a l'entete, 100 chargees. La
 * ligne vise 1400, l'entete n'en permet que 1344 : 44 places etaient neuves, 56
 * s'etaient liberees. La zone affiche 1344 et l'ecart tombe a zero.
 *
 * RIEN N'EST INVENTE ICI. Ce calcul ne dit pas ce qui a ete consomme — il ne
 * fait que remplir des emplacements. La consommation se lit toujours en cumul
 * entre deux cliches, cote serveur. Et l'operateur garde la main : des qu'il
 * ecrit lui-meme dans « Presentes », la ligne est figee et plus rien ne la
 * recalcule.
 */
function ajusterPlaces(
  ls: LigneSaisie[],
  places: number,
  type: TypeFiche,
): LigneSaisie[] {
  if (type !== 'CHARGE' && type !== 'DECHARGE') return ls
  const sens = type === 'CHARGE' ? 1 : -1

  const vise = ls.map((l) =>
    l.presentes_forcees
      ? l.presentes
      : Math.max(0, l.avant_bobines + sens * Math.max(0, l.mouvementees)),
  )

  // Le prorata ne porte que sur les lignes reellement chargees et non figees.
  const ajustable = ls.map((l) =>
    type === 'CHARGE' && !l.presentes_forcees && l.mouvementees > 0 ? l.mouvementees : 0,
  )
  const charge = ajustable.reduce((s, v) => s + v, 0)
  const surplus = vise.reduce((s, v) => s + v, 0) - places

  if (!places || charge <= 0 || surplus <= 0) {
    return ls.map((l, i) => (l.presentes === vise[i] ? l : { ...l, presentes: vise[i] }))
  }

  let reste = Math.min(surplus, charge)
  let vus = 0
  return ls.map((l, i) => {
    if (ajustable[i] <= 0) return l.presentes === vise[i] ? l : { ...l, presentes: vise[i] }
    vus += ajustable[i]
    // La derniere ligne chargee absorbe le reliquat : la somme retombe juste.
    const part = vus >= charge ? reste : Math.round((surplus * ajustable[i]) / charge)
    const pris = Math.max(0, Math.min(part, reste, ajustable[i]))
    reste -= pris
    return { ...l, presentes: vise[i] - pris }
  })
}

export function useFiche(machine: string, zone: Zone | null, type: TypeFiche) {
  const qc = useQueryClient()

  const qEtat = useQuery({
    queryKey: ['machine-etat', machine, zone?.code_emplacement],
    queryFn: () => machinesApi.etat(machine, zone!.code_emplacement),
    enabled: !!zone,
  })

  const [entete, poserEntete] = useState({
    date: aujourdHui(),
    magasin: '',
    responsable: '',
    of: '',
    bobinesEtage: 0,
    observations: '',
  })
  const [lignes, setLignes] = useState<LigneSaisie[]>([])
  const [amorcee, setAmorcee] = useState<string | null>(null)

  /* LE CONSTAT COURANT AMORCE LA SAISIE.
     L'operateur ne repart jamais d'une page blanche : ce que la zone porte
     s'affiche deja, et il ne touche que ce qui a change. C'est ce qui rend une
     mise a jour instantanee — il ne corrige que des pourcentages. */
  const cle = `${zone?.code_emplacement}|${type}`
  if (zone && qEtat.data && amorcee !== cle) {
    setAmorcee(cle)
    setLignes(qEtat.data.map(depuisEtat))
    poserEntete((e) => ({ ...e, bobinesEtage: zone.capacite_bobines }))
  }

  /** Changer le nombre d'emplacements rejoue le remplissage. */
  function setEntete(n: typeof entete) {
    poserEntete(n)
    if (n.bobinesEtage !== entete.bobinesEtage) {
      setLignes((ls) => ajusterPlaces(ls, n.bobinesEtage, type))
    }
  }

  function majLigne(cleLigne: string, champ: keyof LigneSaisie, v: unknown) {
    setLignes((ls) => {
      const maj = ls.map((l) =>
        l.cle === cleLigne
          ? { ...l, [champ]: v, ...(champ === 'presentes' ? { presentes_forcees: true } : {}) }
          : l,
      )
      return champ === 'mouvementees' ? ajusterPlaces(maj, entete.bobinesEtage, type) : maj
    })
  }

  function retirer(cleLigne: string) {
    setLignes((ls) => ls.filter((l) => l.cle !== cleLigne))
  }

  function ajouter(l: LigneSaisie) {
    setLignes((ls) => [...ls, { ...l, cle: `${l.code_reference}|${l.lot_fournisseur}|${ls.length}` }])
  }

  const totaux = useMemo(() => {
    const presentes = lignes.reduce((s, l) => s + l.presentes, 0)
    return {
      presentes,
      etatKg: lignes.reduce((s, l) => s + etatKg(l), 0),
      mouvementees: lignes.reduce((s, l) => s + l.mouvementees, 0),
      /* LES EMPLACEMENTS NE SONT JAMAIS A MOITIE DECLARES.
         Une zone de 1344 places porte 1344 bobines — pas « au plus 1344 ». Le
         manque est donc aussi fautif que le depassement : c'est ce qui rattrape
         une ligne oubliee, et un compte incomplet fausserait la consommation
         qui en decoule.
         Le nombre de reference est celui de l'ENTETE, saisi par le magasinier :
         il constate le physique, le parametrage suivra. */
      ecart: presentes - (entete.bobinesEtage || 0),
    }
  }, [lignes, entete.bobinesEtage])

<<<<<<< HEAD
  /* LE SOLDE DU LOT EST APPROXIMATIF, ET L'ATELIER LE SAIT.
     Quand une bobine redescend d'un metier, personne ne sait de quel lot elle
     venait : le retour est impute au juge, et les soldes par lot derivent. Le
     magasinier se retrouve alors devant des bobines qu'il a dans les mains,
     et un ERP qui lui dit qu'elles n'existent pas.
     On ne supprime pas la verification — elle rattrape les vraies fautes de
     saisie — mais on PROPOSE de passer outre. Le refus devient une question,
     et la reponse laisse une trace. */
  const [lotCourt, setLotCourt] = useState<string | null>(null)

  const envoi = useMutation({
    mutationFn: async (forcerLot?: boolean) => {
      const corps = corpsFiche(type, machine, zone!.code_emplacement, entete, lignes)
      if (forcerLot) {
        corps.lignes = corps.lignes.map((l) => ({
          ...l,
          lot_force: true,
          motif_lot_force:
            'Retour de machine impute au juge : le solde du lot ne reflete plus le physique.',
        }))
      }
      const r = await machinesApi.creerFiche(corps)
      return machinesApi.valider(r.id_fiche)
    },
    onError: (e: unknown) => {
      // ON NE DEVINE PAS LE REFUS AU TEXTE ENTIER : le serveur prefixe ce cas
      // precis par « R02-LOT ». Chercher « insuffisant » attraperait aussi le
      // refus de magasin, qui lui ne doit JAMAIS etre franchissable.
      const message = e instanceof Error ? e.message : String(e)
      if (message.includes('R02-LOT')) setLotCourt(message)
    },
=======
  const envoi = useMutation({
    mutationFn: async () => {
      const r = await machinesApi.creerFiche(
        corpsFiche(type, machine, zone!.code_emplacement, entete, lignes),
      )
      return machinesApi.valider(r.id_fiche)
    },
>>>>>>> b12ddbbaab00dcf9c7e5e767fc70a7998f5a28ca
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['machine-etat'] })
      void qc.invalidateQueries({ queryKey: ['machines'] })
      void qc.invalidateQueries({ queryKey: ['machine-plan'] })
      void qc.invalidateQueries({ queryKey: ['machine-fiches'] })
<<<<<<< HEAD
      void qc.invalidateQueries({ queryKey: ['machine-contenu'] })
      void qc.invalidateQueries({ queryKey: ['machine-conso'] })
      setLotCourt(null)
=======
>>>>>>> b12ddbbaab00dcf9c7e5e767fc70a7998f5a28ca
      setAmorcee(null)
    },
  })

  const pret =
    !!zone &&
    !!entete.responsable.trim() &&
    lignes.length > 0 &&
    totaux.ecart === 0 &&
    (type === 'MAJ' || type === 'CONSO' || !!entete.magasin) &&
    lignes.every((l) => l.lot_fournisseur.trim().length > 0)

  return {
<<<<<<< HEAD
    /** Le refus de solde de lot, quand il y en a un : l'ecran le propose. */
    lotCourt, oublierLotCourt: () => setLotCourt(null),
=======
>>>>>>> b12ddbbaab00dcf9c7e5e767fc70a7998f5a28ca
    etat: qEtat, entete, setEntete, lignes, setLignes,
    majLigne, retirer, ajouter, totaux, envoi, pret,
    reamorcer: () => setAmorcee(null),
  }
}
