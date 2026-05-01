import type { Doc } from "@/convex/_generated/dataModel";
import { calculateSaveRate, calculateVerdict, type Verdict } from "./verdict";

type Publication = Doc<"publications">;

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
export const aggregateByFormat = (pubs: Publication[]) =>
  aggregateBy(pubs, (p) => p.format);
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
    .map((p) => {
      const saveRate = calculateSaveRate(p.saves, p.vuesJ7);
      const verdict = calculateVerdict(saveRate);
      return {
        hookText: p.hookText,
        carouselId: p.carouselId,
        plateforme: p.plateforme,
        vuesJ7: p.vuesJ7 ?? 0,
        saveRate: saveRate ?? 0,
        verdict,
      };
    })
    .filter(
      (h): h is TopHook & { verdict: NonNullable<Verdict> } =>
        h.saveRate > 0 && h.verdict !== null,
    )
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
