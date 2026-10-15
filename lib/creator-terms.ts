import { evaluateVideoBonus, type VideoBonusGrid } from "./pricing-engine";

/**
 * « MON CONTRAT » — ce que l'écran décide, isolé et testé.
 *
 * Le barème vient de `convex/creatorTerms` ; la position du cycle vient du MÊME
 * breakdown que « Mes paiements » (moteur de paie). Rien n'est recalculé ici :
 * on choisit quoi montrer et on lit où elle en est.
 */

/** Barème tel que le renvoie `creatorTerms.getMyTerms` (sans le nom interne). */
export type Terms = {
  pricingId: string;
  currency: string | null;
  montantFixe: number;
  nbVideosCible: number;
  tauxCPM: number;
  seuilVuesFixe: number;
  plafondParVideo: number;
  videoBonus: VideoBonusGrid | null;
  hasCumulTiers: boolean;
};

/** Ce qu'il faut du breakdown du cycle en cours (cf convex/pricing PricingBreakdown). */
export type CycleBreakdown = {
  perPricing: {
    pricingId: string;
    montantFixe: number;
    nbVideosCible: number;
    seuilVuesFixe: number;
    videoCount: number;
    fixed: number;
    groupViews: number;
    fixeBloque: boolean;
  }[];
  perAssignment: { assignmentId: string; pricingId: string }[];
  videoBonuses: { assignmentId: string; views: number; montant: number }[];
};

/** Part fixe d'une vidéo publiée (le moteur la borne ensuite au budget du cycle). */
export function fixePerVideo(t: Pick<Terms, "montantFixe" | "nbVideosCible">): number {
  return t.nbVideosCible > 0 ? t.montantFixe / t.nbVideosCible : 0;
}

export type TermsPosition = {
  /** Fixe du cycle SUR CE CONTRAT. */
  fixe: { videoCount: number; fixed: number; groupViews: number; fixeBloque: boolean };
  /** La vidéo du cycle la plus haut dans la grille de bonus (null = aucune n'a franchi de palier). */
  bestVideo: { assignmentId: string; views: number } | null;
  /**
   * Le cycle contient des vidéos payées sur d'AUTRES termes — un autre barème,
   * ou une version antérieure de celui-ci (snapshot figé à l'attribution).
   */
  otherTerms: boolean;
};

/**
 * Où en est la créatrice, sur CE contrat, dans le cycle en cours.
 *
 * Un groupe du breakdown est « ce contrat » s'il porte le même barème ET les
 * mêmes termes (fixe, cible, seuil) : une vidéo attribuée avant une modification
 * du barème garde son snapshot, et l'additionner ici ferait mentir la jauge.
 */
export function termsPosition(t: Terms, b: CycleBreakdown): TermsPosition {
  const isThis = (g: CycleBreakdown["perPricing"][number]) =>
    g.pricingId === t.pricingId &&
    g.montantFixe === t.montantFixe &&
    g.nbVideosCible === t.nbVideosCible &&
    g.seuilVuesFixe === t.seuilVuesFixe;
  const mine = b.perPricing.filter(isThis);
  const fixe = {
    videoCount: mine.reduce((s, g) => s + g.videoCount, 0),
    fixed: Math.round(mine.reduce((s, g) => s + g.fixed, 0) * 100) / 100,
    groupViews: mine.reduce((s, g) => s + g.groupViews, 0),
    fixeBloque: mine.some((g) => g.fixeBloque),
  };
  // La grille est lue sur le barème de CHAQUE vidéo : ne garder que les vidéos
  // de ce contrat. Sans `perAssignment` (cycle gelé), on ne sait pas trier, et
  // on ne montre pas de « meilleure vidéo » plutôt qu'une fausse.
  const onThis = new Set(
    b.perAssignment.filter((a) => a.pricingId === t.pricingId).map((a) => a.assignmentId),
  );
  const best = b.videoBonuses
    .filter((v) => v.montant > 0 && onThis.has(v.assignmentId))
    .reduce<{ assignmentId: string; views: number } | null>(
      (acc, v) => (acc === null || v.views > acc.views ? { assignmentId: v.assignmentId, views: v.views } : acc),
      null,
    );
  return {
    fixe,
    bestVideo: best,
    otherTerms: b.perPricing.some((g) => !isThis(g)),
  };
}

export type LadderRow = {
  seuilVues: number;
  montant: number;
  /** done = franchi par la meilleure vidéo ; next = le prochain ; todo = au-delà. */
  state: "done" | "next" | "todo";
};

/**
 * La grille de bonus par vidéo, vue depuis la meilleure vidéo du cycle — même
 * évaluation que la paie (evaluateVideoBonus). `views` null = aucune vidéo n'a
 * franchi de palier : le premier palier est le prochain, sans compte à rebours.
 */
export function bonusLadder(
  grid: VideoBonusGrid,
  views: number | null,
): { rows: LadderRow[]; toNext: number | null } {
  const e = evaluateVideoBonus(views ?? 0, grid);
  const crossed = new Set(e.crossed.map((c) => c.seuilVues));
  const sorted = [...grid.tiers].sort((a, b) => a.seuilVues - b.seuilVues);
  return {
    rows: sorted.map((tier) => ({
      seuilVues: tier.seuilVues,
      montant: tier.montant,
      state: crossed.has(tier.seuilVues)
        ? "done"
        : tier.seuilVues === e.nextTier?.seuilVues
          ? "next"
          : "todo",
    })),
    toNext: views === null ? null : e.viewsToNext,
  };
}

export type TermsRule =
  | "platformsAdd"
  | "window30"
  | "warmupNoBonus"
  | "highestTierOnly"
  | "tiersAdd"
  | "capPerVideo"
  | "paidEvery30";

/**
 * Les règles à rappeler — SEULEMENT celles que ce contrat met en jeu. Rappeler
 * la fenêtre de 30 jours à une créatrice au fixe seul lui ferait chercher des
 * vues qui ne la paient pas.
 */
export function termsRules(t: Terms): TermsRule[] {
  const paidOnViews =
    t.tauxCPM > 0 || t.videoBonus !== null || t.seuilVuesFixe > 0 || t.hasCumulTiers;
  const rules: TermsRule[] = [];
  if (paidOnViews) rules.push("platformsAdd", "window30");
  if (t.videoBonus !== null || t.hasCumulTiers) rules.push("warmupNoBonus");
  if (t.videoBonus !== null) {
    rules.push(t.videoBonus.cumulative ? "tiersAdd" : "highestTierOnly");
  }
  if (t.tauxCPM > 0) rules.push("capPerVideo");
  rules.push("paidEvery30");
  return rules;
}

/** Plus haut montant de la grille par vidéo (résumé de la carte Gains). */
export function maxVideoBonus(grid: VideoBonusGrid): number {
  if (grid.cumulative) return grid.tiers.reduce((s, t) => s + Math.max(0, t.montant), 0);
  return grid.tiers.reduce((m, t) => Math.max(m, t.montant), 0);
}
