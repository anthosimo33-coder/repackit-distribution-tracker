/**
 * Moteur de calcul de PAIE par PRICING (pur, testé Vitest). De l'ARGENT : la
 * source de vérité du calcul. RÉPLIQUÉ à l'identique dans convex/pricing.ts
 * (règle A6 — un module convex/ ne peut pas importer lib/). Toute évolution
 * DOIT être appliquée des DEUX côtés + couverte par les tests.
 *
 * Modèle (3 composantes), pour un (créateur, projet, MOIS) :
 *
 *  1. FIXE mensuel — réparti par VIDÉO UNIQUE PUBLIÉE, groupé par pricing :
 *     fixePerVideo = montantFixe / nbVideosCible (figé sur le snapshot).
 *     Pour chaque groupe de vidéos partageant le même pricingId :
 *       fixeGroupe = min(nbVidéosDuGroupe × fixePerVideo, montantFixe)   (PLAFOND)
 *     Total fixe = Σ fixeGroupe. Le plafond s'applique PAR (créateur, pricingId,
 *     mois) — aucun couplage inter-créateurs. UNE vidéo = UN assignment publié,
 *     comptée UNE seule fois quel que soit le nombre de cibles/plateformes
 *     (l'appelant fournit 1 item par assignment).
 *
 *  2. CPM — par vidéo, sur les VUES TOTALES (somme des plateformes) :
 *     cpm = (totalViews / 1000) × tauxCPM. Les plateformes COMPTENT (somme
 *     TikTok + IG + YouTube faite par l'appelant avant d'entrer ici).
 *
 *  3. BONUS — PAR VIDÉO (par assignment) : montantBonus une seule fois si
 *     totalViews >= seuilBonusVues, sinon 0.
 *
 *  total = Σ fixe + Σ cpm + Σ bonus.
 *
 * Tous les montants sont arrondis au centime pour que la somme soit exacte.
 */

export type PricingSnapshot = {
  pricingId: string;
  montantFixe: number;
  nbVideosCible: number;
  tauxCPM: number;
  seuilBonusVues: number;
  montantBonus: number;
};

/** Une vidéo publiée du mois : 1 assignment + ses vues totales (somme cibles). */
export type PayoutItem = {
  assignmentId: string;
  snapshot: PricingSnapshot;
  totalViews: number;
};

export type PerPricing = {
  pricingId: string;
  videoCount: number;
  nbVideosCible: number;
  montantFixe: number;
  fixePerVideo: number;
  fixed: number;
  cpm: number;
  bonus: number;
};

export type PerAssignment = {
  assignmentId: string;
  pricingId: string;
  totalViews: number;
  cpm: number;
  bonus: number;
};

export interface MonthlyPayout {
  fixedTotal: number;
  cpmTotal: number;
  bonusTotal: number;
  total: number;
  perPricing: PerPricing[];
  perAssignment: PerAssignment[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** CPM d'une vidéo (vues totales, toutes plateformes confondues). */
export function assignmentCpm(snapshot: PricingSnapshot, totalViews: number): number {
  const v = Math.max(0, totalViews);
  return round2((v / 1000) * snapshot.tauxCPM);
}

/** Bonus d'une vidéo : montantBonus une fois si le seuil de vues est atteint. */
export function assignmentBonus(snapshot: PricingSnapshot, totalViews: number): number {
  const v = Math.max(0, totalViews);
  return v >= snapshot.seuilBonusVues ? round2(snapshot.montantBonus) : 0;
}

/** Fixe par vidéo (figé) ; 0 si nbVideosCible invalide (garde anti /0). */
function fixePerVideo(snapshot: PricingSnapshot): number {
  if (!(snapshot.nbVideosCible > 0)) return 0;
  return snapshot.montantFixe / snapshot.nbVideosCible;
}

/**
 * Calcule la paie du mois à partir des vidéos publiées (1 item par assignment
 * publié, avec son pricingSnapshot figé et ses vues totales).
 */
export function computeMonthlyPayout(items: PayoutItem[]): MonthlyPayout {
  // Groupes par pricingId (pour le fixe plafonné) — ordre de 1re apparition.
  const groups = new Map<string, PayoutItem[]>();
  for (const it of items) {
    const arr = groups.get(it.snapshot.pricingId);
    if (arr) arr.push(it);
    else groups.set(it.snapshot.pricingId, [it]);
  }

  const perPricing: PerPricing[] = [];
  const perAssignment: PerAssignment[] = [];
  let fixedTotal = 0;
  let cpmTotal = 0;
  let bonusTotal = 0;

  for (const [pricingId, groupItems] of groups) {
    const snapshot = groupItems[0].snapshot;
    const perVideo = fixePerVideo(snapshot);
    const videoCount = groupItems.length;
    const fixed = round2(Math.min(videoCount * perVideo, snapshot.montantFixe));

    let groupCpm = 0;
    let groupBonus = 0;
    for (const it of groupItems) {
      const cpm = assignmentCpm(it.snapshot, it.totalViews);
      const bonus = assignmentBonus(it.snapshot, it.totalViews);
      groupCpm = round2(groupCpm + cpm);
      groupBonus = round2(groupBonus + bonus);
      perAssignment.push({
        assignmentId: it.assignmentId,
        pricingId: it.snapshot.pricingId,
        totalViews: Math.max(0, it.totalViews),
        cpm,
        bonus,
      });
    }

    perPricing.push({
      pricingId,
      videoCount,
      nbVideosCible: snapshot.nbVideosCible,
      montantFixe: snapshot.montantFixe,
      fixePerVideo: round2(perVideo),
      fixed,
      cpm: groupCpm,
      bonus: groupBonus,
    });
    fixedTotal = round2(fixedTotal + fixed);
    cpmTotal = round2(cpmTotal + groupCpm);
    bonusTotal = round2(bonusTotal + groupBonus);
  }

  return {
    fixedTotal,
    cpmTotal,
    bonusTotal,
    total: round2(fixedTotal + cpmTotal + bonusTotal),
    perPricing,
    perAssignment,
  };
}
