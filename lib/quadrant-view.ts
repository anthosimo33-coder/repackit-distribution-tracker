/**
 * MISE EN FORME de la carte « Vues × Intent » — du classement STOCKÉ sur la
 * publication (`publications.quadrant`, écrit par le relevé nocturne) aux points
 * réellement traçables, plus le décompte de ce qui ne l'est pas.
 *
 * Pourquoi un module à part, et pas trois `useMemo` dans le composant : le tri
 * entre « traçable » et « pas traçable » est la partie du rendu qui peut MENTIR.
 * Placer un post dont les saves n'ont jamais été collectées en bas du graphe le
 * condamnerait sur une absence de mesure ; le faire disparaître sans le compter
 * ferait croire à une carte complète. Ce module est donc testé (lib/quadrant.test.ts).
 *
 * Aucune décision n'est prise ici : les scores et la case viennent du serveur
 * tels quels. On ne fait que choisir ce qu'on trace et ce qu'on dit du reste.
 */

import type {
  QuadrantKey,
  QuadrantQualification,
  QuadrantSnapshot,
} from "../convex/quadrant";

/**
 * Le MINIMUM qu'un post doit porter pour être placé. Structurel et non
 * `TrackerPost` : ce module ne doit pas dépendre d'un composant (et le test
 * vitest ne doit pas avoir à transformer du JSX pour vérifier une division).
 * `TrackerPost` satisfait ce contrat, le compilateur le vérifie au point d'appel.
 */
export type QuadrantViewPost = {
  _id: string;
  compte: string;
  plateforme: string;
  datePubli: number;
  vues: number;
  saves?: number | null;
  creatorName: string | null;
  label: string;
  /**
   * Qualification TRI-ÉTAT servie par la query. ABSENTE = le producteur ne l'a
   * pas dite → « autre » (non qualifié), jamais « promo » : un défaut de saisie
   * ne doit pas prendre la couleur d'une décision. C'est exactement le repli
   * qu'appliquait `isWarmup === true`, et qui rendait la couleur « non
   * qualifié » inatteignable.
   */
  qualification?: QuadrantQualification;
  quadrant?: QuadrantSnapshot | null;
};

const DAY_MS = 86_400_000;

/** Un point traçable. `x`/`y` sont déjà dans l'unité de l'axe. */
export type QuadrantDatum = {
  id: string;
  /** Score de distribution (vues ÷ médiane du compte). Axe X, échelle log. */
  x: number;
  /** Save rate EN POURCENTS (le score brut ×100). Axe Y. */
  y: number;
  /** Save rate brut, conservé pour l'infobulle (formatage identique au reste). */
  scoreIntent: number;
  /** `null` tant que le post est en attente : il n'a pas de case, par choix. */
  quadrant: QuadrantKey | null;
  pending: boolean;
  breakout: boolean;
  qualification: QuadrantQualification;
  /** Médiane du compte, pour expliquer le score dans l'infobulle. */
  baselineViews: number | null;
  vues: number;
  saves: number | null;
  creatorName: string | null;
  compte: string;
  plateforme: string;
  label: string;
  datePubli: number;
};

/**
 * Pourquoi un post publié n'apparaît pas sur le graphe. Chaque cas est une
 * IGNORANCE différente, et aucune n'est une contre-performance.
 */
export type UnplacedReason =
  | "pending"
  | "not_measured"
  | "no_baseline"
  | "saves_unavailable"
  | "saves_collecting"
  | "no_views";

export const UNPLACED_REASONS: readonly UnplacedReason[] = [
  "pending",
  "not_measured",
  "no_baseline",
  "saves_unavailable",
  "saves_collecting",
  "no_views",
] as const;

export type QuadrantView = {
  points: QuadrantDatum[];
  /** Posts publiés de la période qu'on ne sait pas placer, par raison. */
  unplaced: Record<UnplacedReason, number>;
  /**
   * Posts encore JAMAIS classés (aucun relevé nocturne depuis leur création).
   * Séparé des `unplaced` : ce n'est pas une limite de la donnée, c'est un
   * calcul qui n'a pas encore tourné.
   */
  notComputed: number;
  /** Posts publiés dans la période, toutes situations confondues. */
  total: number;
  /** Effectif de chaque case (posts classés uniquement). */
  counts: Record<QuadrantKey, number>;
};

function emptyUnplaced(): Record<UnplacedReason, number> {
  return {
    pending: 0,
    not_measured: 0,
    no_baseline: 0,
    saves_unavailable: 0,
    saves_collecting: 0,
    no_views: 0,
  };
}

function emptyCounts(): Record<QuadrantKey, number> {
  return { scale: 0, intent_faible: 0, distribution_faible: 0, archiver: 0 };
}

/**
 * La raison d'un post non traçable. `no_intent` porte déjà sa raison précise ;
 * les autres statuts SONT leur propre raison. Un `no_intent` sans raison stockée
 * (donnée antérieure au champ) retombe sur « collecte en cours », la lecture la
 * moins définitive des trois.
 */
function reasonOf(q: QuadrantSnapshot): UnplacedReason {
  if (q.status === "no_intent") return q.reason ?? "saves_collecting";
  if (q.status === "not_measured") return "not_measured";
  if (q.status === "no_baseline") return "no_baseline";
  return "pending";
}

/**
 * Construit la vue de la carte pour une fenêtre d'affichage de `periodDays`.
 *
 * ⚠️ La période ne RECALCULE rien : elle choisit les posts affichés. Les scores
 * ont été calculés la nuit sur la fenêtre de référence des comptes
 * (`BASELINE_WINDOW_DAYS`), et regarder 7 jours ne les rejoue pas sur 7 jours —
 * sans quoi le même post changerait de case selon le zoom, ce qui rendrait la
 * carte inutilisable comme repère de décision.
 *
 * Un post EN ATTENTE est tracé en gris dès que ses deux scores sont calculables
 * (il a une position, pas de verdict) ; s'il lui manque un score, il rejoint le
 * décompte des non traçables. Les deux lectures sont vraies, et aucune ne fait
 * passer une absence de mesure pour un résultat.
 */
export function buildQuadrantView(
  posts: readonly QuadrantViewPost[],
  now: number,
  periodDays: number,
): QuadrantView {
  const floor = now - periodDays * DAY_MS;
  const points: QuadrantDatum[] = [];
  const unplaced = emptyUnplaced();
  const counts = emptyCounts();
  let notComputed = 0;
  let total = 0;

  for (const p of posts) {
    if (p.datePubli < floor) continue;
    total += 1;

    const q = p.quadrant;
    if (!q) {
      notComputed += 1;
      continue;
    }

    const placeable =
      (q.status === "classified" || q.status === "pending") &&
      q.scoreDistribution !== undefined &&
      q.scoreIntent !== undefined &&
      // Une échelle logarithmique ne place pas le zéro. Un score nul (post à 0
      // vue sur un compte qui a une référence) est une mesure réelle, mais elle
      // n'a pas de position sur cet axe : elle est comptée, pas inventée.
      q.scoreDistribution > 0;

    if (!placeable) {
      unplaced[reasonOf(q)] += 1;
      continue;
    }

    if (q.status === "classified" && q.key) counts[q.key] += 1;

    points.push({
      id: p._id as string,
      x: q.scoreDistribution as number,
      y: (q.scoreIntent as number) * 100,
      scoreIntent: q.scoreIntent as number,
      quadrant: q.status === "classified" ? (q.key ?? null) : null,
      pending: q.status === "pending",
      breakout: q.breakoutWindow,
      qualification: p.qualification ?? "autre",
      baselineViews: q.baselineViews ?? null,
      vues: p.vues,
      saves: p.saves ?? null,
      creatorName: p.creatorName,
      compte: p.compte,
      plateforme: p.plateforme,
      label: p.label,
      datePubli: p.datePubli,
    });
  }

  return { points, unplaced, notComputed, total, counts };
}

/** Total des posts non traçables, toutes raisons confondues. */
export function unplacedTotal(unplaced: Record<UnplacedReason, number>): number {
  return UNPLACED_REASONS.reduce((s, r) => s + unplaced[r], 0);
}

/**
 * Bornes de l'axe X (échelle LOG, donc jamais 0). Le seuil de distribution est
 * TOUJOURS dans le domaine : une ligne de seuil hors du cadre laisserait croire
 * que tous les points sont du même côté.
 */
export function xDomain(
  points: readonly QuadrantDatum[],
  threshold: number,
): [number, number] {
  const xs = points.map((p) => p.x).filter((x) => x > 0);
  const lo = Math.min(threshold, ...(xs.length ? xs : [threshold]));
  const hi = Math.max(threshold, ...(xs.length ? xs : [threshold]));
  return [Math.max(lo / 1.6, 0.01), hi * 1.6];
}

/** Bornes de l'axe Y (linéaire, en pourcents). Le seuil y est toujours visible. */
export function yDomain(
  points: readonly QuadrantDatum[],
  thresholdPct: number,
): [number, number] {
  const hi = Math.max(thresholdPct, ...points.map((p) => p.y));
  return [0, hi * 1.15 || 1];
}

/** Graduations lisibles d'un axe log, restreintes au domaine tracé. */
export function xTicks([lo, hi]: [number, number]): number[] {
  const candidates = [
    0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 3, 5, 10, 20, 50, 100, 200, 500,
  ];
  return candidates.filter((c) => c >= lo && c <= hi);
}
