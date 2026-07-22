/**
 * Moteur de calcul de PAIE par PRICING (pur, testé Vitest). De l'ARGENT : la
 * source de vérité du calcul. RÉPLIQUÉ à l'identique dans convex/pricing.ts
 * (règle A6 — un module convex/ ne peut pas importer lib/). Toute évolution
 * DOIT être appliquée des DEUX côtés + couverte par les tests.
 *
 * Modèle (v2), pour un (créateur, projet) :
 *
 *  1. FIXE mensuel — réparti par VIDÉO UNIQUE PUBLIÉE, groupé par pricing,
 *     plafonné à montantFixe par (créateur, pricingId, mois). PAR VIDÉO.
 *  2. CPM — par vidéo, sur les VUES TOTALES (somme des plateformes).
 *  3. BONUS À PALIERS — créateur-niveau, sur le CUMUL TOTAL À VIE de ses vues
 *     (somme de toutes ses vidéos publiées). Chaque palier (cash ou nature) se
 *     débloque UNE fois quand le cumul atteint son seuilVues. Le CASH compte
 *     dans le total € ; le NATURE est une récompense due (hors total €). La
 *     PERSISTANCE du déblocage (idempotent, période d'attribution, freeze) est
 *     gérée côté serveur (bonusUnlocks) ; ici on fournit le PUR :
 *       - computeMonthlyPayout → fixe + CPM (PAS de bonus par vidéo en v2) ;
 *       - tiersOf → grille de paliers (avec fallback legacy seuil unique) ;
 *       - evaluateBonusTiers → état des paliers pour la jauge (AFFICHAGE).
 *
 * Tous les montants sont arrondis au centime pour que la somme soit exacte.
 */

export type PricingSnapshot = {
  pricingId: string;
  montantFixe: number;
  nbVideosCible: number;
  tauxCPM: number;
  // LEGACY v1 (seuil unique par vidéo) — conservés sur les snapshots existants,
  // PLUS utilisés par le moteur v2 (le bonus est désormais à paliers cumulés).
  seuilBonusVues?: number;
  montantBonus?: number;
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
};

export type PerAssignment = {
  assignmentId: string;
  pricingId: string;
  totalViews: number;
  cpm: number;
};

export interface MonthlyPayout {
  fixedTotal: number;
  cpmTotal: number;
  total: number; // fixe + CPM (le bonus cash à paliers est ajouté côté serveur)
  perPricing: PerPricing[];
  perAssignment: PerAssignment[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Plafond DUR de rémunération PAR VIDÉO — GLOBAL, tous projets (Snytch, RepackIt,
 * …), JAMAIS scopé par projet. Dès que la paie d'UNE vidéo (part fixe + CPM ; ou
 * base + bonus dans le modèle legacy) atteint ce montant, elle est plafonnée —
 * même à des dizaines de millions de vues. Appliqué à la SOURCE du calcul par
 * vidéo (computeMonthlyPayout / estimateMissionEarnings ici ; computeEarnings
 * dans lib/earnings) et RÉPLIQUÉ côté convex (A6). Le total mensuel = SOMME des
 * vidéos DÉJÀ plafonnées (le cap est par vidéo, jamais sur le total agrégé).
 */
export const MAX_PAY_PER_VIDEO_EUR = 150;

/** CPM d'une vidéo (vues totales, toutes plateformes confondues). */
export function assignmentCpm(snapshot: PricingSnapshot, totalViews: number): number {
  const v = Math.max(0, totalViews);
  return round2((v / 1000) * snapshot.tauxCPM);
}

/** Fixe par vidéo (figé) ; 0 si nbVideosCible invalide (garde anti /0). */
function fixePerVideo(snapshot: PricingSnapshot): number {
  if (!(snapshot.nbVideosCible > 0)) return 0;
  return snapshot.montantFixe / snapshot.nbVideosCible;
}

export interface MissionEstimate {
  /** Part FIXE par vidéo (montantFixe / nbVideosCible). */
  fixed: number;
  /** Part CPM pour `views` (tauxCPM × views / 1000). */
  cpm: number;
  /** fixed + cpm. */
  total: number;
}

/**
 * Estimation de rému d'UNE mission (affichage fiche créateur, modèle pricing v2),
 * pilotée par un nombre de vues (slider) : FIXE/vidéo + CPM(vues). RÉUTILISE les
 * fonctions pures du moteur (fixePerVideo, assignmentCpm) → cohérent avec
 * computeMonthlyPayout, qui exclut lui aussi tout bonus du per-mission. Les
 * paliers de bonus (créateur-niveau, cumul à vie) NE sont PAS inclus ici : ils
 * vivent sur le doc pricings et sont affichés sur l'écran Paiements
 * (evaluateBonusTiers / getMyBonusStatus), pas par mission.
 */
export function estimateMissionEarnings(
  snapshot: PricingSnapshot,
  views: number,
): MissionEstimate {
  const fixed = round2(fixePerVideo(snapshot));
  const cpm = assignmentCpm(snapshot, views);
  const total = round2(fixed + cpm);
  if (total <= MAX_PAY_PER_VIDEO_EUR) return { fixed, cpm, total };
  // Plafond 150 €/vidéo : on garde la part fixe et on rogne le CPM (puis le fixe
  // au cas pathologique fixe/vidéo > 150). Cohérent avec computeMonthlyPayout.
  const cappedFixed = Math.min(fixed, MAX_PAY_PER_VIDEO_EUR);
  const cappedCpm = round2(MAX_PAY_PER_VIDEO_EUR - cappedFixed);
  return { fixed: cappedFixed, cpm: cappedCpm, total: MAX_PAY_PER_VIDEO_EUR };
}

// ─── Warmup — exclusion des posts de la paie (par POST) ──────────────────────

/** Un post publié d'une vidéo : ses vues + son flag warmup. */
export type PublicationViews = { views: number; isWarmup: boolean };

export interface PayableViews {
  /** Σ des vues des posts NON-warmup — base du CPM ET du cumul de paliers. */
  payableViews: number;
  /**
   * La vidéo compte-t-elle comme une VIDÉO PAYABLE (part fixe) ? true sauf si
   * elle a ≥1 post ET qu'ils sont TOUS warmup (→ vidéo entièrement warmup,
   * exclue du fixe). Une vidéo SANS post matérialisé garde le comportement
   * historique (compte pour le fixe) → un post warmup ne peut que RETIRER.
   */
  hasPayablePost: boolean;
}

/**
 * Vues PAYABLES d'une vidéo = somme des vues de ses posts NON-warmup. Les posts
 * `isWarmup` sont EXCLUS : ni CPM sur leurs vues, ni cumul pour les paliers.
 * `hasPayablePost` pilote le FIXE (une vidéo tout-warmup ne compte pas comme
 * vidéo publiée). SOURCE UNIQUE de la règle warmup (pure, testée Vitest) —
 * RÉPLIQUÉE dans convex/pricing.ts (règle A6). Sans aucun post warmup :
 * payableViews === Σ vues et hasPayablePost === true → comportement INCHANGÉ.
 */
export function payableAssignmentViews(pubs: PublicationViews[]): PayableViews {
  let payableViews = 0;
  let nonWarmupCount = 0;
  for (const p of pubs) {
    if (p.isWarmup) continue;
    nonWarmupCount += 1;
    payableViews += Math.max(0, p.views);
  }
  return {
    payableViews,
    hasPayablePost: pubs.length === 0 || nonWarmupCount > 0,
  };
}

/**
 * Paie du mois (FIXE + CPM) à partir des vidéos publiées (1 item par assignment
 * publié). PAS de bonus par vidéo en v2 (le bonus est créateur-niveau à paliers
 * cumulés, géré séparément).
 */
export function computeMonthlyPayout(items: PayoutItem[]): MonthlyPayout {
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

  for (const [pricingId, groupItems] of groups) {
    const snapshot = groupItems[0].snapshot;
    const perVideo = fixePerVideo(snapshot);
    const videoCount = groupItems.length;
    // Fixe du groupe (plafonné au budget montantFixe) — arrondi AU NIVEAU DU
    // GROUPE, calcul INCHANGÉ hors plafond 150 (sous-cap = octet pour octet).
    const fixedGroup = round2(Math.min(videoCount * perVideo, snapshot.montantFixe));

    // ─── Plafond 150 €/vidéo ───────────────────────────────────────────────
    // Chaque vidéo = part fixe (répartie, bornée au budget montantFixe) + CPM.
    // Le dépassement au-delà de MAX_PAY_PER_VIDEO_EUR est rogné sur le CPM en
    // premier, puis sur la part fixe (cas pathologique fixe/vidéo > 150). Sans
    // dépassement, fixedOverflow reste 0 → fixe et CPM identiques à avant.
    let remainingFixe = snapshot.montantFixe;
    let groupCpm = 0;
    let fixedOverflow = 0;
    for (const it of groupItems) {
      const fixedShare = Math.min(perVideo, Math.max(0, remainingFixe));
      remainingFixe -= fixedShare;
      const cpm = assignmentCpm(it.snapshot, it.totalViews);
      const excess = Math.max(0, fixedShare + cpm - MAX_PAY_PER_VIDEO_EUR);
      const cpmOverflow = Math.min(cpm, excess);
      fixedOverflow += excess - cpmOverflow;
      const cappedCpm = round2(cpm - cpmOverflow);
      groupCpm = round2(groupCpm + cappedCpm);
      perAssignment.push({
        assignmentId: it.assignmentId,
        pricingId: it.snapshot.pricingId,
        totalViews: Math.max(0, it.totalViews),
        cpm: cappedCpm,
      });
    }
    const fixed = round2(fixedGroup - fixedOverflow);

    perPricing.push({
      pricingId,
      videoCount,
      nbVideosCible: snapshot.nbVideosCible,
      montantFixe: snapshot.montantFixe,
      fixePerVideo: round2(perVideo),
      fixed,
      cpm: groupCpm,
    });
    fixedTotal = round2(fixedTotal + fixed);
    cpmTotal = round2(cpmTotal + groupCpm);
  }

  return {
    fixedTotal,
    cpmTotal,
    total: round2(fixedTotal + cpmTotal),
    perPricing,
    perAssignment,
  };
}

// ─── Paliers de bonus (cumul de vues créateur) ───────────────────────────────

export type BonusTier = {
  seuilVues: number;
  rewardType: "cash" | "nature";
  montant?: number;
  libelle?: string;
};

/** Source de paliers d'un pricing (avec fallback legacy seuil unique → 1 cash). */
export function tiersOf(pricing: {
  bonusTiers?: BonusTier[];
  seuilBonusVues?: number;
  montantBonus?: number;
}): BonusTier[] {
  if (pricing.bonusTiers && pricing.bonusTiers.length > 0) {
    return pricing.bonusTiers;
  }
  if (
    (pricing.seuilBonusVues ?? 0) > 0 &&
    (pricing.montantBonus ?? 0) > 0
  ) {
    return [
      {
        seuilVues: pricing.seuilBonusVues!,
        rewardType: "cash",
        montant: pricing.montantBonus!,
      },
    ];
  }
  return [];
}

export interface BonusTierEvaluation {
  /** Paliers franchis (seuil ≤ cumul), triés par seuil croissant. */
  crossed: BonusTier[];
  /** Total € des paliers CASH franchis (les nature sont exclus). */
  cashCrossedTotal: number;
  /** Paliers NATURE franchis (récompenses dues). */
  natureCrossed: BonusTier[];
  /** Prochain palier non encore franchi (le plus bas au-dessus du cumul). */
  nextTier: BonusTier | null;
  /** Vues restantes avant le prochain palier (null si aucun). */
  viewsToNext: number | null;
}

/**
 * État des paliers pour un cumul donné — AFFICHAGE (jauge) UNIQUEMENT. Le €
 * réellement crédité vient des bonusUnlocks persistés (serveur), jamais d'ici.
 */
export function evaluateBonusTiers(
  cumulViews: number,
  tiers: BonusTier[],
): BonusTierEvaluation {
  const cumul = Math.max(0, cumulViews);
  const sorted = [...tiers].sort((a, b) => a.seuilVues - b.seuilVues);
  const crossed = sorted.filter((t) => cumul >= t.seuilVues);
  const cashCrossedTotal = round2(
    crossed
      .filter((t) => t.rewardType === "cash")
      .reduce((s, t) => s + (t.montant ?? 0), 0),
  );
  const natureCrossed = crossed.filter((t) => t.rewardType === "nature");
  const nextTier = sorted.find((t) => cumul < t.seuilVues) ?? null;
  return {
    crossed,
    cashCrossedTotal,
    natureCrossed,
    nextTier,
    viewsToNext: nextTier ? Math.max(0, nextTier.seuilVues - cumul) : null,
  };
}
