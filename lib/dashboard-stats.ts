import type { Doc } from "@/convex/_generated/dataModel";
import { calculateSaveRate, calculateVerdict, type Verdict } from "./verdict";

type Publication = Doc<"publications">;

/**
 * CONTRAT — toutes les fonctions de ce module attendent en entrée une liste
 * de publications DÉJÀ filtrée sur isPublished(). Le filtrage se fait en
 * amont au callsite (cf. app/page.tsx, app/tracker/page.tsx). Les fonctions
 * elles-mêmes ne re-filtrent pas — c'est la responsabilité de l'appelant
 * pour éviter la double-filtration et garder ces fonctions pures.
 *
 * Justification : un draft (= postUrl vide) n'a sémantiquement pas de
 * verdict ni de save rate à agréger. Inclure ces rows fausserait les KPIs.
 */

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
  const groups = new Map<string, Publication[]>();
  for (const pub of publications) {
    const k = keyFn(pub);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(pub);
  }

  const result: AggregateRow[] = [];
  for (const [key, pubs] of groups.entries()) {
    const totalVues = pubs.reduce((sum, p) => sum + (p.vuesJ7 ?? 0), 0);

    const saveRates = pubs
      .map((p) => calculateSaveRate(p.saves, p.vuesJ7))
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
      const sr = calculateSaveRate(pub.saves, pub.vuesJ7);
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

  return result.sort(
    (a, b) => (b.avgSaveRate ?? -1) - (a.avgSaveRate ?? -1),
  );
}

export const aggregateByMecanique = (pubs: Publication[]) =>
  aggregateBy(pubs, (p) => p.mecanique);
export const aggregateByNiveau = (pubs: Publication[]) =>
  aggregateBy(pubs, (p) => p.niveau);
// p.format peut être undefined (Shorts). Coerce en "—" pour distinguer
// visuellement les rows sans format ; ces buckets seront filtrés en amont
// quand le dashboard splittera par mediaType (Batch 3).
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
  vuesJ7: number;
  saveRate: number;
  verdict: NonNullable<Verdict>;
};

export function getTopHooks(
  publications: Publication[],
  n: number = 10,
): TopHook[] {
  return publications
    .flatMap<TopHook>((p) => {
      const saveRate = calculateSaveRate(p.saves, p.vuesJ7);
      const verdict = calculateVerdict(saveRate);
      if (saveRate === null || verdict === null || saveRate <= 0) return [];
      return [
        {
          hookText: p.hookText,
          carouselId: p.carouselId,
          plateforme: p.plateforme,
          vuesJ7: p.vuesJ7 ?? 0,
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
  let totalVues = 0;
  const rates: number[] = [];
  let winners = 0;
  for (const p of publications) {
    if (p.vuesJ7 !== null) totalVues += p.vuesJ7;
    const r = calculateSaveRate(p.saves, p.vuesJ7);
    if (r !== null) rates.push(r);
    if (calculateVerdict(r) === "WINNER") winners++;
  }
  return {
    total: publications.length,
    totalVues,
    avgSaveRate:
      rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
    winners,
  };
}

// ─── Batch 3 Modif 5 — Shorts analytics (ajouts purs) ─────────────────────
//
// Les fonctions ci-dessus restent inchangées et opèrent en pratique
// uniquement sur des Carrousels (le callsite DashboardContent filtre upstream
// via getMediaType). Les fonctions *Shorts ci-dessous opèrent uniquement sur
// des Shorts. Sémantique distincte : pas de verdict, métrique principale =
// ratio subsGained/vuesJ7 (équivalent du saveRate côté carrousel).

export type GlobalStatsShorts = {
  total: number;
  totalVuesJ7: number;
  avgLikes: number | null;
  totalSubsGained: number;
  // sum(subsGained) / sum(vuesJ7), null si totalVues = 0 ou aucun
  // subsGained renseigné. Cohérence d'unité avec saveRate (ratio entre
  // 0 et 1, formaté en % à l'affichage).
  ratioSubsViews: number | null;
};

export function getGlobalStatsShorts(
  publications: Publication[],
): GlobalStatsShorts {
  let totalVuesJ7 = 0;
  let totalSubsGained = 0;
  const likesValues: number[] = [];
  for (const p of publications) {
    if (p.vuesJ7 !== null) totalVuesJ7 += p.vuesJ7;
    if (p.subsGained !== null && p.subsGained !== undefined) {
      totalSubsGained += p.subsGained;
    }
    if (p.likes !== null && p.likes !== undefined) likesValues.push(p.likes);
  }
  return {
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
  vuesJ7: number;
  likes: number | null;
  subsGained: number;
};

export function getTopHooksShorts(
  publications: Publication[],
  n: number = 10,
): TopHookShort[] {
  return publications
    .flatMap<TopHookShort>((p) => {
      // Exclure les Shorts sans subsGained renseigné — pas de tri sur null,
      // cohérent avec getTopHooks carrousel qui exclut saveRate null.
      if (p.subsGained === null || p.subsGained === undefined) return [];
      return [
        {
          hookText: p.hookText,
          carouselId: p.carouselId,
          plateforme: p.plateforme,
          vuesJ7: p.vuesJ7 ?? 0,
          likes: p.likes ?? null,
          subsGained: p.subsGained,
        },
      ];
    })
    .sort((a, b) => {
      // Tri principal : subsGained desc. Tie-break : vuesJ7 desc (cohérent
      // avec convention "le plus récent en haut" sur égalité).
      if (b.subsGained !== a.subsGained) return b.subsGained - a.subsGained;
      return b.vuesJ7 - a.vuesJ7;
    })
    .slice(0, n);
}

export type AggregateRowShort = {
  key: string;
  count: number;
  totalVues: number;
  totalLikes: number;
  totalSubsGained: number;
  // Ratio bucket-level : sum(subsGained_bucket) / sum(vuesJ7_bucket).
  // Pas une moyenne d'individus — évite les biais de petits échantillons
  // (1 viral à 10k vues + 1 flop à 100 vues n'est pas dilué).
  avgRatioSubsViews: number | null;
};

function aggregateByShorts(
  publications: Publication[],
  keyFn: (p: Publication) => string,
): AggregateRowShort[] {
  const groups = new Map<string, Publication[]>();
  for (const pub of publications) {
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
      if (p.vuesJ7 !== null) totalVues += p.vuesJ7;
      if (p.likes !== null && p.likes !== undefined) totalLikes += p.likes;
      if (p.subsGained !== null && p.subsGained !== undefined) {
        totalSubsGained += p.subsGained;
      }
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
// Pas de aggregateByFormatShorts (format A-H carousel-only).
// Pas de aggregateByCompteShorts pour ce batch — non demandé par le scope
// dashboard Shorts (4 charts : Mécanique / Niveau / Angle / Plateforme).

// ─── Batch D — ScreenRecorder (alias des fonctions Shorts) ─────────────────
//
// Le shape stats ScreenRecorder est strictement identique à celui des Shorts
// (likes / subsGained / comments / vues, pas de saveRate ni verdict). Plutôt
// que de dupliquer les fonctions, on expose des aliases nommés screenrecorder
// pour la lisibilité du callsite. Si un jour les SR divergent (ex: ajout
// d'une métrique watch_time), il sera temps de splitter.
export const getGlobalStatsScreenRecorder = getGlobalStatsShorts;
export const getTopHooksScreenRecorder = getTopHooksShorts;
export const aggregateByMecaniqueScreenRecorder = aggregateByMecaniqueShorts;
export const aggregateByNiveauScreenRecorder = aggregateByNiveauShorts;
export const aggregateByAngleScreenRecorder = aggregateByAngleShorts;
export const aggregateByPlateformeScreenRecorder = aggregateByPlateformeShorts;
