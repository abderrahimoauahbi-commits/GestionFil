/**
 * LE PLAN DE LA SIMULATION : ce qui arrive a l'usine, jour par jour, de
 * janvier 2024 a aujourd'hui. Il est DETERMINISTE (graine fixe, catalogue trie) :
 * relance apres un arret, il redonne exactement les memes evenements, et le
 * journal dit lesquels sont deja saisis.
 *
 * Le plan ne decide que ce qui se sait d'avance — les cours, les commandes, les
 * livraisons. Ce qui depend du stock du jour (quoi charger sur un etage, combien
 * sortir) se decide a l'execution, en lisant le serveur comme le ferait le
 * magasinier.
 */

export interface RefCatalogue {
  code_reference: string
  code_fournisseur: string
  code_categorie: string
  poids_bobine_kg: number | null
  prix_catalogue: number | null
  code_devise_catalogue: string | null
  suivi_lot: number
}

export interface LignePlan {
  ref: string
  kg: number
  prix: number
  /** Ce que le magasin pesera a l'arrivee (a quelques kilos du bon de livraison). */
  pese: number
  bl: number
  lot: string
  magasin: string
}

export type Evenement =
  | { id: string; date: string; type: 'TAUX'; devise: string; taux: number }
  | {
      id: string
      date: string
      type: 'BC'
      fournisseur: string
      devise: string
      livraison: string
      /** Le cours du jour du bon, que la direction retient a la validation. */
      taux: number
      lignes: LignePlan[]
    }
  | { id: string; date: string; type: 'BC_VALIDER'; bc: string; taux: number; dateBc: string }
  | { id: string; date: string; type: 'RECEPTION'; bc: string; fournisseur: string; lignes: LignePlan[] }
  /** Un retour au fournisseur : une partie d'un lot recu, non conforme, rendue quelques jours apres. */
  | { id: string; date: string; type: 'RETOUR'; reception: string; fournisseur: string; ligne: LignePlan; kg: number }
  | { id: string; date: string; type: 'MACHINE'; machine: string; zone: string; capacite: number }
  | { id: string; date: string; type: 'SORTIE' }
  | { id: string; date: string; type: 'INVENTAIRE'; magasin: string }

/**
 * LES COURS MENSUELS (MAD pour une unite), approximation des moyennes Bank
 * Al-Maghrib — a remplacer par les cours officiels si la comptabilite les
 * fournit. Deux cours par mois, le 1er et le 15, a quelques millimes pres.
 */
const COURS: Record<string, [number, number]> = {
  '2024-01': [10.03, 10.92], '2024-02': [10.06, 10.86], '2024-03': [10.10, 10.95], '2024-04': [10.08, 10.84],
  '2024-05': [10.00, 10.83], '2024-06': [9.95, 10.71], '2024-07': [9.86, 10.70], '2024-08': [9.75, 10.73],
  '2024-09': [9.70, 10.78], '2024-10': [9.85, 10.73], '2024-11': [10.00, 10.62], '2024-12': [10.05, 10.50],
  '2025-01': [10.05, 10.42], '2025-02': [9.98, 10.38], '2025-03': [9.70, 10.50], '2025-04': [9.35, 10.55],
  '2025-05': [9.25, 10.45], '2025-06': [9.12, 10.55], '2025-07': [9.00, 10.55], '2025-08': [9.05, 10.55],
  '2025-09': [9.10, 10.65], '2025-10': [9.15, 10.65], '2025-11': [9.20, 10.62], '2025-12': [9.18, 10.70],
  '2026-01': [9.15, 10.68], '2026-02': [9.10, 10.66], '2026-03': [9.12, 10.70], '2026-04': [9.08, 10.72],
  '2026-05': [9.05, 10.70], '2026-06': [9.10, 10.68], '2026-07': [9.12, 10.66], '2026-08': [9.15, 10.70],
  '2026-09': [9.12, 10.72], '2026-10': [9.10, 10.70],
}

/** Le generateur pseudo-aleatoire a graine (mulberry32) : le meme plan a chaque passage. */
function hasard(graine: number) {
  let a = graine >>> 0
  const suivant = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    reel: (min: number, max: number) => min + (max - min) * suivant(),
    entier: (min: number, max: number) => Math.floor(min + (max - min + 1) * suivant()),
    parmi: <T>(t: T[]): T => t[Math.floor(suivant() * t.length)],
    tirer: <T>(t: T[], n: number): T[] => {
      const copie = [...t]
      const out: T[] = []
      while (out.length < n && copie.length) out.push(copie.splice(Math.floor(suivant() * copie.length), 1)[0])
      return out
    },
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const ajouter = (jour: string, n: number) => {
  const d = new Date(`${jour}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}
/** Un jour ouvre : le dimanche, l'usine est fermee. */
const ouvre = (jour: string) => (new Date(`${jour}T00:00:00Z`).getUTCDay() === 0 ? ajouter(jour, 1) : jour)
const arrondi = (v: number, pas: number) => Math.max(pas, Math.round(v / pas) * pas)

/** Le cours d'un jour : celui du dernier releve (1er ou 15 du mois), tel que saisi. */
export function coursDu(evenements: Evenement[], devise: string, jour: string): number {
  let t = 0
  for (const e of evenements) if (e.type === 'TAUX' && e.devise === devise && e.date <= jour) t = e.taux
  return t
}

export const FIL = ['PP', 'PES', 'PES-SH', 'PES-PO', 'PES-CH']
export const MATIERES_HORS_MACHINE = ['JUT', 'LAI', 'SBR', 'CUI', 'PLA']

export interface Machine {
  code: string
  zones: { code: string; capacite: number }[]
}

export function construirePlan(catalogue: RefCatalogue[], machines: Machine[], aujourdhui: string): Evenement[] {
  const h = hasard(20240101)
  // Les retours ont leur propre tirage : ajoutes apres coup (10/10/2026), ils ne
  // decalent aucun autre evenement du plan deja saisi.
  const hr = hasard(20240202)
  const ev: Evenement[] = []
  const refs = [...catalogue].sort((a, b) => a.code_reference.localeCompare(b.code_reference))
  const fil = refs.filter((r) => FIL.includes(r.code_categorie) && (r.poids_bobine_kg ?? 0) > 0 && r.suivi_lot === 1)
  const fournisseursFil = [...new Set(fil.map((r) => r.code_fournisseur))].sort()
  const veille = ajouter(aujourdhui, -1)

  // --- Les cours, deux fois par mois ---------------------------------------
  for (const [mois, [usd, eur]] of Object.entries(COURS)) {
    for (const [jour, bruit] of [[`${mois}-01`, -0.012], [`${mois}-15`, 0.009]] as const) {
      if (jour > aujourdhui) continue
      ev.push({ id: `T-USD-${jour}`, date: jour, type: 'TAUX', devise: 'USD', taux: +(usd + bruit + h.reel(-0.01, 0.01)).toFixed(4) })
      ev.push({ id: `T-EUR-${jour}`, date: jour, type: 'TAUX', devise: 'EUR', taux: +(eur - bruit + h.reel(-0.01, 0.01)).toFixed(4) })
    }
  }
  // Le cours de la semaine : un bon en devise ne se valide pas sur un cours de plus de 7 jours.
  ev.push({ id: `T-USD-${veille}`, date: veille, type: 'TAUX', devise: 'USD', taux: 9.1132 })
  ev.push({ id: `T-EUR-${veille}`, date: veille, type: 'TAUX', devise: 'EUR', taux: 10.6981 })

  // --- Les achats, mois par mois ------------------------------------------
  let rang = 0
  const lot = (frs: string, jour: string, i: number) => `${frs.replace('FRS-', 'L')}-${jour.replace(/-/g, '').slice(2)}-${i + 1}`
  const commande = (jour: string, frs: string, devise: string, choix: RefCatalogue[], delai: number, kg: () => number) => {
    rang++
    const id = `BC-${jour}-${frs}-${rang}`
    const livraison = ajouter(jour, delai)
    const taux = devise === 'MAD' ? 1 : coursDu(ev, devise, jour)
    // L'inflation douce du fil : +2 % par an sur le prix catalogue, a quelques % pres.
    const annees = (new Date(jour).getTime() - new Date('2026-10-01').getTime()) / (365 * 864e5)
    const recue = ouvre(ajouter(livraison, h.entier(-3, 6)))
    const magasin = rang % 3 === 0 ? 'Morocco' : 'Polyfashions'
    const lignes: LignePlan[] = choix.map((r, i) => {
      const q = kg()
      const bl = +(q * h.reel(0.995, 1.004)).toFixed(1)
      return {
        ref: r.code_reference,
        kg: q,
        prix: +((r.prix_catalogue ?? 1) * (1 + 0.02 * annees) * h.reel(0.97, 1.03)).toFixed(4),
        bl,
        pese: +(bl * h.reel(0.996, 1.002)).toFixed(2),
        lot: lot(frs, recue, i),
        magasin,
      }
    })
    ev.push({ id, date: jour, type: 'BC', fournisseur: frs, devise, livraison, taux, lignes })
    const valide = ouvre(ajouter(jour, h.entier(1, 3)))
    ev.push({ id: `${id}-V`, date: valide, type: 'BC_VALIDER', bc: id, taux: devise === 'MAD' ? 1 : coursDu(ev, devise, valide), dateBc: jour })
    // On ne livre pas un bon qui n'est pas encore valide : au plus tot le lendemain.
    const arrivee = recue > valide ? recue : ouvre(ajouter(valide, 1))
    if (arrivee <= veille) {
      ev.push({ id: `${id}-R`, date: arrivee, type: 'RECEPTION', bc: id, fournisseur: frs, lignes })
      // UNE LIVRAISON SUR HUIT a un defaut constate au deballage : une partie du
      // lot repart chez le fournisseur, en citant la reception.
      if (hr.reel(0, 1) < 0.125) {
        const l = hr.parmi(lignes)
        const retour = ouvre(ajouter(arrivee, hr.entier(2, 6)))
        const kg = Math.max(10, Math.round(l.pese * hr.reel(0.02, 0.06)))
        if (retour <= veille) ev.push({ id: `${id}-RF`, date: retour, type: 'RETOUR', reception: `${id}-R`, fournisseur: frs, ligne: l, kg })
      }
    }
  }

  for (let d = new Date('2024-01-01T00:00:00Z'); iso(d) <= aujourdhui; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const mois = iso(d).slice(0, 7)
    const n = Number(mois.slice(0, 4)) * 12 + Number(mois.slice(5, 7))
    // Trois commandes de fil par mois, chez des fournisseurs qui tournent.
    for (let k = 0; k < 3; k++) {
      const frs = fournisseursFil[(n * 3 + k) % fournisseursFil.length]
      const jour = ouvre(`${mois}-${String(3 + k * 8 + h.entier(0, 3)).padStart(2, '0')}`)
      if (jour > veille) continue
      const choix = h.tirer(fil.filter((r) => r.code_fournisseur === frs), h.entier(2, 3))
      // L'Inde livre en sept semaines, la Turquie en quatre.
      const delai = frs === 'FRS-006' ? h.entier(45, 55) : h.entier(24, 34)
      if (choix.length) commande(jour, frs, 'USD', choix, delai, () => arrondi(h.reel(1500, 3600), 50))
    }
    // Le plastique d'emballage, chaque mois, chez l'un ou l'autre fournisseur local.
    const frsPla = n % 2 ? 'FRS-011' : 'FRS-012'
    const jourPla = ouvre(`${mois}-${String(12 + h.entier(0, 4)).padStart(2, '0')}`)
    if (jourPla <= veille) {
      const pla = h.tirer(refs.filter((r) => r.code_fournisseur === frsPla && r.code_categorie === 'PLA'), 2)
      commande(jourPla, frsPla, 'MAD', pla, h.entier(3, 8), () => arrondi(h.reel(250, 600), 10))
    }
    // La jute tous les deux mois ; latex, hotmelt et cuir chaque trimestre.
    const jourJute = ouvre(`${mois}-${String(18 + h.entier(0, 4)).padStart(2, '0')}`)
    if (n % 2 === 0 && jourJute <= veille) {
      const jute = h.tirer(refs.filter((r) => r.code_categorie === 'JUT'), 2)
      commande(jourJute, 'FRS-010', 'USD', jute, h.entier(24, 34), () => arrondi(h.reel(800, 1600), 50))
    }
    if (n % 3 === 0 && jourJute <= veille) {
      const divers = refs.filter((r) => r.code_fournisseur === 'FRS-002' && ['LAI', 'SBR', 'CUI'].includes(r.code_categorie))
      commande(ouvre(ajouter(jourJute, 2)), 'FRS-002', 'USD', divers, h.entier(24, 34), () => arrondi(h.reel(300, 700), 10))
    }

    // --- La production : deux etages par machine et par mois -------------
    for (const [im, m] of machines.entries()) {
      const etages = m.zones
      for (let v = 0; v < 2; v++) {
        const z = etages[(n * 2 + v + im) % etages.length]
        const jour = ouvre(`${mois}-${String(9 + v * 11 + im).padStart(2, '0')}`)
        if (jour > veille) continue
        ev.push({ id: `M-${jour}-${z.code}`, date: jour, type: 'MACHINE', machine: m.code, zone: z.code, capacite: z.capacite })
      }
    }
    // --- Les matieres hors machine sortent pour l'atelier, en fin de mois --
    const jourSortie = ouvre(`${mois}-27`)
    if (jourSortie <= veille) ev.push({ id: `S-${jourSortie}`, date: jourSortie, type: 'SORTIE' })
  }

  // --- L'inventaire d'aujourd'hui, magasin par magasin ----------------------
  for (const magasin of ['Polyfashions', 'Morocco']) ev.push({ id: `I-${aujourdhui}-${magasin}`, date: aujourdhui, type: 'INVENTAIRE', magasin })

  // L'ordre du temps ; le meme jour, les cours d'abord, puis les documents dans
  // l'ordre ou ils se font au bureau : livraisons, commandes, production, sorties.
  const poids: Record<Evenement['type'], number> = { TAUX: 0, RECEPTION: 1, RETOUR: 2, BC_VALIDER: 3, BC: 4, MACHINE: 5, SORTIE: 6, INVENTAIRE: 7 }
  return ev.sort((a, b) => a.date.localeCompare(b.date) || poids[a.type] - poids[b.type] || a.id.localeCompare(b.id))
}
