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
