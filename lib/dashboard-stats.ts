import type { Doc } from "@/convex/_generated/dataModel";
import type { DisplayMetrics } from "@/convex/metricsDisplay";
import { calculateSaveRate, calculateVerdict, type Verdict } from "./verdict";
import { filterByWarmupMode } from "./warmup-mode";

/**
 * Refactor multi-snapshots — toutes les agrégations lisent désormais
 * `publication.displayMetrics` (résolu serveur pour la période sélectionnée),
 * et NON plus les anciens champs scalaires vuesJ7/saves/likes/subsGained.
 *
 * CONTRAT inchangé : l'entrée est une liste DÉJÀ filtrée sur isPublished()
 * (cf. callsites). Les fonctions restent pures.
 */

type Publication = Doc<"publications"> & { displayMetrics?: DisplayMetrics };

const NO_METRICS: Pick<
  DisplayMetrics,
  "vues" | "likes" | "saves" | "subsGained" | "comments"
> = { vues: null, likes: null, saves: null, subsGained: null, comments: null };

/** Métriques affichables d'une publication (snapshot résolu) ou tout-null. */
function m(p: Publication) {
  return p.displayMetrics ?? NO_METRICS;
}

export type AggregateRow = {
  key: string;
  count: number;
  totalVues: number;
  avgSaveRate: number | null;
  winners: number;
  moyens: number;
  folds: number;
  pending: number;
};

function aggregateBy(
  publications: Publication[],
  keyFn: (p: Publication) => string,
): AggregateRow[] {
  // TD-019 : surface de perf/classement → warmup exclu (helper unique).
  const monetized = filterByWarmupMode(
    publications,
    (p) => p.isWarmup === true,
    "exclude",
  );
  const groups = new Map<string, Publication[]>();
  for (const pub of monetized) {
    const k = keyFn(pub);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(pub);
  }

  const result: AggregateRow[] = [];
  for (const [key, pubs] of groups.entries()) {
    const totalVues = pubs.reduce((sum, p) => sum + (m(p).vues ?? 0), 0);

    const saveRates = pubs
      .map((p) => calculateSaveRate(m(p).saves, m(p).vues))
      .filter((sr): sr is number => sr !== null);
    const avgSaveRate =
      saveRates.length > 0
        ? saveRates.reduce((a, b) => a + b, 0) / saveRates.length
        : null;

    let winners = 0,
      moyens = 0,
      folds = 0,
      pending = 0;
    for (const pub of pubs) {
      const sr = calculateSaveRate(m(pub).saves, m(pub).vues);
      const v = calculateVerdict(sr);
      if (v === "WINNER") winners++;
      else if (v === "MOYEN") moyens++;
      else if (v === "FOLD") folds++;
      else pending++;
    }

    result.push({
      key,
      count: pubs.length,
      totalVues,
      avgSaveRate,
      winners,
      moyens,
      folds,
      pending,
    });
  }

  return result.sort((a, b) => (b.avgSaveRate ?? -1) - (a.avgSaveRate ?? -1));
}

export const aggregateByMecanique = (pubs: Publication[]) =>
  aggregateBy(pubs, (p) => p.mecanique);
export const aggregateByNiveau = (pubs: Publication[]) =>
  aggregateBy(pubs, (p) => p.niveau);
export const aggregateByFormat = (pubs: Publication[]) =>
  aggregateBy(pubs, (p) => p.format ?? "—");
export const aggregateByAngle = (pubs: Publication[]) =>
  aggregateBy(pubs, (p) => p.angleTonal);
export const aggregateByPlateforme = (pubs: Publication[]) =>
  aggregateBy(pubs, (p) => p.plateforme);
export const aggregateByCompte = (pubs: Publication[]) =>
  aggregateBy(pubs, (p) => p.compte);

export type TopHook = {
  hookText: string;
  carouselId: string;
  plateforme: string;
  vues: number;
  saveRate: number;
  verdict: NonNullable<Verdict>;
};

export function getTopHooks(
  publications: Publication[],
  n: number = 10,
): TopHook[] {
  // TD-019 : top hooks = classement de perf → warmup exclu.
  return filterByWarmupMode(publications, (p) => p.isWarmup === true, "exclude")
    .flatMap<TopHook>((p) => {
      const saveRate = calculateSaveRate(m(p).saves, m(p).vues);
      const verdict = calculateVerdict(saveRate);
      if (saveRate === null || verdict === null || saveRate <= 0) return [];
      return [
        {
          hookText: p.hookText,
          carouselId: p.carouselId,
          plateforme: p.plateforme,
          vues: m(p).vues ?? 0,
          saveRate,
          verdict,
        },
      ];
    })
    .sort((a, b) => b.saveRate - a.saveRate)
    .slice(0, n);
}

export type GlobalStats = {
  total: number;
  totalVues: number;
  avgSaveRate: number | null;
  winners: number;
};

export function getGlobalStats(publications: Publication[]): GlobalStats {
  // TD-019 : KPI de perf → warmup exclu (total, vues, save rate, winners).
  const pubs = filterByWarmupMode(
    publications,
    (p) => p.isWarmup === true,
    "exclude",
  );
  let totalVues = 0;
  const rates: number[] = [];
  let winners = 0;
  for (const p of pubs) {
    const vues = m(p).vues;
    if (vues !== null) totalVues += vues;
    const r = calculateSaveRate(m(p).saves, vues);
    if (r !== null) rates.push(r);
    if (calculateVerdict(r) === "WINNER") winners++;
  }
  return {
    // COUNT = tous les publiés (un post de chauffe est bien publié) ; seules les
    // MÉTRIQUES/RATIOS excluent le warmup (TD-019).
    total: publications.length,
    totalVues,
    avgSaveRate:
      rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
    winners,
  };
}

// ─── Shorts / ScreenRecorder — ratio subsGained/vues ───────────────────────

export type GlobalStatsShorts = {
  total: number;
  totalVuesJ7: number;
  avgLikes: number | null;
  totalSubsGained: number;
  ratioSubsViews: number | null;
};

export function getGlobalStatsShorts(
  publications: Publication[],
): GlobalStatsShorts {
  // TD-019 : KPI de perf → warmup exclu.
  const pubs = filterByWarmupMode(
    publications,
    (p) => p.isWarmup === true,
    "exclude",
  );
  let totalVuesJ7 = 0;
  let totalSubsGained = 0;
  const likesValues: number[] = [];
  for (const p of pubs) {
    const dm = m(p);
    if (dm.vues !== null) totalVuesJ7 += dm.vues;
    if (dm.subsGained !== null) totalSubsGained += dm.subsGained;
    if (dm.likes !== null) likesValues.push(dm.likes);
  }
  return {
    // COUNT = tous les publiés ; seules les MÉTRIQUES/RATIOS excluent le warmup.
    total: publications.length,
    totalVuesJ7,
    avgLikes:
      likesValues.length > 0
        ? likesValues.reduce((a, b) => a + b, 0) / likesValues.length
        : null,
    totalSubsGained,
    ratioSubsViews: totalVuesJ7 > 0 ? totalSubsGained / totalVuesJ7 : null,
  };
}

export type TopHookShort = {
  hookText: string;
  carouselId: string;
  plateforme: string;
  vues: number;
  likes: number | null;
  subsGained: number;
};

export function getTopHooksShorts(
  publications: Publication[],
  n: number = 10,
): TopHookShort[] {
  // TD-019 : top hooks = classement de perf → warmup exclu.
  return filterByWarmupMode(publications, (p) => p.isWarmup === true, "exclude")
    .flatMap<TopHookShort>((p) => {
      const dm = m(p);
      if (dm.subsGained === null) return [];
      return [
        {
          hookText: p.hookText,
          carouselId: p.carouselId,
          plateforme: p.plateforme,
          vues: dm.vues ?? 0,
          likes: dm.likes,
          subsGained: dm.subsGained,
        },
      ];
    })
    .sort((a, b) => {
      if (b.subsGained !== a.subsGained) return b.subsGained - a.subsGained;
      return b.vues - a.vues;
    })
    .slice(0, n);
}

export type AggregateRowShort = {
  key: string;
  count: number;
  totalVues: number;
  totalLikes: number;
  totalSubsGained: number;
  avgRatioSubsViews: number | null;
};

function aggregateByShorts(
  publications: Publication[],
  keyFn: (p: Publication) => string,
): AggregateRowShort[] {
  // TD-019 : surface de perf/classement → warmup exclu (helper unique).
  const monetized = filterByWarmupMode(
    publications,
    (p) => p.isWarmup === true,
    "exclude",
  );
  const groups = new Map<string, Publication[]>();
  for (const pub of monetized) {
    const k = keyFn(pub);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(pub);
  }

  const result: AggregateRowShort[] = [];
  for (const [key, pubs] of groups.entries()) {
    let totalVues = 0;
    let totalLikes = 0;
    let totalSubsGained = 0;
    for (const p of pubs) {
      const dm = m(p);
      if (dm.vues !== null) totalVues += dm.vues;
      if (dm.likes !== null) totalLikes += dm.likes;
      if (dm.subsGained !== null) totalSubsGained += dm.subsGained;
    }
    result.push({
      key,
      count: pubs.length,
      totalVues,
      totalLikes,
      totalSubsGained,
      avgRatioSubsViews: totalVues > 0 ? totalSubsGained / totalVues : null,
    });
  }

  return result.sort(
    (a, b) => (b.avgRatioSubsViews ?? -1) - (a.avgRatioSubsViews ?? -1),
  );
}

export const aggregateByMecaniqueShorts = (pubs: Publication[]) =>
  aggregateByShorts(pubs, (p) => p.mecanique);
export const aggregateByNiveauShorts = (pubs: Publication[]) =>
  aggregateByShorts(pubs, (p) => p.niveau);
export const aggregateByAngleShorts = (pubs: Publication[]) =>
  aggregateByShorts(pubs, (p) => p.angleTonal);
export const aggregateByPlateformeShorts = (pubs: Publication[]) =>
  aggregateByShorts(pubs, (p) => p.plateforme);

// ─── ScreenRecorder — aliases (shape stats identique aux Shorts) ───────────
export const getGlobalStatsScreenRecorder = getGlobalStatsShorts;
export const getTopHooksScreenRecorder = getTopHooksShorts;
export const aggregateByMecaniqueScreenRecorder = aggregateByMecaniqueShorts;
export const aggregateByNiveauScreenRecorder = aggregateByNiveauShorts;
export const aggregateByAngleScreenRecorder = aggregateByAngleShorts;
export const aggregateByPlateformeScreenRecorder = aggregateByPlateformeShorts;

// ─── Dimensions SR + ICP (filtre sur champ publication, métriques via dm) ──
export const aggregateByRecordingDevice = (pubs: Publication[]) =>
  aggregateByShorts(
    pubs.filter((p) => p.recordingDevice !== undefined),
    (p) => p.recordingDevice as string,
  );

export const aggregateByRepackaging = (pubs: Publication[]) =>
  aggregateByShorts(
    pubs.filter((p) => p.isRepackaging !== undefined),
    (p) => (p.isRepackaging ? "Repackaging" : "Autre capture"),
  );

export const aggregateByIcp = (pubs: Publication[]) =>
  aggregateByShorts(
    pubs.filter((p) => p.icpId !== undefined),
    (p) => p.icpId as string,
  );
