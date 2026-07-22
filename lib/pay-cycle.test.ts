import { describe, it, expect } from "vitest";
import {
  calcCycle,
  cycleIndexOf,
  cycleWindow,
  cyclePeriodKey,
  CYCLE_LENGTH_MS,
} from "./pay-cycle";
import {
  computeMonthlyPayout,
  type PayoutItem,
  type PricingSnapshot,
} from "./pricing-engine";

const DAY = 86_400_000;
const ANCHOR = Date.UTC(2026, 5, 5); // 5 juin 2026 (1er post d'un créateur)
const round2 = (n: number) => Math.round(n * 100) / 100;

describe("calcCycle — bornes et index", () => {
  it("cycle 0 dès le 1er post (borne basse incluse)", () => {
    const c = calcCycle(ANCHOR, ANCHOR);
    expect(c.cycleIndex).toBe(0);
    expect(c.cycleStart).toBe(ANCHOR);
    expect(c.cycleEnd).toBe(ANCHOR + CYCLE_LENGTH_MS);
  });

  it("dernier ms du cycle 0 reste cycle 0 (fin EXCLUE)", () => {
    expect(calcCycle(ANCHOR, ANCHOR + CYCLE_LENGTH_MS - 1).cycleIndex).toBe(0);
  });

  it("exactement +30 j bascule au cycle 1 (borne haute exclue)", () => {
    const c = calcCycle(ANCHOR, ANCHOR + CYCLE_LENGTH_MS);
    expect(c.cycleIndex).toBe(1);
    expect(c.cycleStart).toBe(ANCHOR + CYCLE_LENGTH_MS);
  });

  it("k = floor((now − firstPostAt)/30 j)", () => {
    expect(calcCycle(ANCHOR, ANCHOR + 95 * DAY).cycleIndex).toBe(3); // 95/30 = 3.16…
    expect(cycleIndexOf(ANCHOR, ANCHOR + 59 * DAY)).toBe(1);
    expect(cycleIndexOf(ANCHOR, ANCHOR + 60 * DAY)).toBe(2);
  });

  it("now avant firstPostAt → cycle 0 (borné, pas d'index négatif)", () => {
    expect(calcCycle(ANCHOR, ANCHOR - 10 * DAY).cycleIndex).toBe(0);
  });

  it("cycleEnd du cycle courant = date de PROCHAINE PAIE", () => {
    const c = calcCycle(ANCHOR, ANCHOR + 40 * DAY); // cycle 1
    expect(c.cycleEnd).toBe(ANCHOR + 2 * CYCLE_LENGTH_MS);
  });

  it("cycleWindow(k) cohérent avec calcCycle", () => {
    const w = cycleWindow(ANCHOR, 3);
    expect(w).toEqual(calcCycle(ANCHOR, ANCHOR + 3 * CYCLE_LENGTH_MS + 5 * DAY));
  });

  it("cyclePeriodKey = date de début ISO (UTC, triable)", () => {
    expect(cyclePeriodKey(ANCHOR)).toBe("2026-06-05");
    expect(cyclePeriodKey(ANCHOR + CYCLE_LENGTH_MS)).toBe("2026-07-05");
  });
});

// ─── INVARIANT : re-fenêtrer les gains ne change PAS le total dû ──────────────
// Chaque vidéo a une date ; on la range dans SON cycle. Σ des totaux par cycle
// DOIT égaler le total calculé sur l'ensemble (mêmes gains, juste re-groupés).

const snap = (over: Partial<PricingSnapshot> = {}): PricingSnapshot => ({
  pricingId: "p1",
  montantFixe: 0,
  nbVideosCible: 10,
  tauxCPM: 2,
  seuilBonusVues: 0,
  montantBonus: 0,
  ...over,
});

/** 6 vidéos étalées sur ~4 cycles de 30 j. */
const VIDS = [
  { publishedAt: ANCHOR + 2 * DAY, totalViews: 10_000 },
  { publishedAt: ANCHOR + 20 * DAY, totalViews: 5_000 },
  { publishedAt: ANCHOR + 35 * DAY, totalViews: 8_000 },
  { publishedAt: ANCHOR + 65 * DAY, totalViews: 3_000 },
  { publishedAt: ANCHOR + 95 * DAY, totalViews: 12_000 },
  { publishedAt: ANCHOR + 96 * DAY, totalViews: 1_000 },
];

function groupByCycle(
  items: (PayoutItem & { publishedAt: number })[],
): PayoutItem[][] {
  const byCycle = new Map<number, PayoutItem[]>();
  for (const it of items) {
    const k = cycleIndexOf(ANCHOR, it.publishedAt);
    const arr = byCycle.get(k);
    if (arr) arr.push(it);
    else byCycle.set(k, [it]);
  }
  return [...byCycle.values()];
}

describe("re-fenêtrage J+30 — INVARIANT du total (montant inchangé)", () => {
  it("CPM pur (montantFixe=0) : Σ cycles == total global", () => {
    const items = VIDS.map((v, i) => ({
      assignmentId: `a${i}`,
      snapshot: snap(),
      totalViews: v.totalViews,
      publishedAt: v.publishedAt,
    }));
    const totalGlobal = computeMonthlyPayout(items).total;
    const sumCycles = groupByCycle(items).reduce(
      (s, g) => s + computeMonthlyPayout(g).total,
      0,
    );
    expect(round2(sumCycles)).toBe(round2(totalGlobal));
    expect(totalGlobal).toBeGreaterThan(0);
  });

  it("fixe SANS plafond atteint (≤ nbVideosCible/fenêtre) : Σ cycles == total", () => {
    // montantFixe=100 / nbVideosCible=10 → 10 $/vidéo. ≤ 2 vidéos/fenêtre ici → jamais cappé.
    const items = VIDS.map((v, i) => ({
      assignmentId: `a${i}`,
      snapshot: snap({ montantFixe: 100, nbVideosCible: 10 }),
      totalViews: v.totalViews,
      publishedAt: v.publishedAt,
    }));
    const totalGlobal = computeMonthlyPayout(items).total;
    const sumCycles = groupByCycle(items).reduce(
      (s, g) => s + computeMonthlyPayout(g).total,
      0,
    );
    expect(round2(sumCycles)).toBe(round2(totalGlobal));
  });

  it("plafond 150 $/vidéo appliqué À LA VIDÉO → indépendant du fenêtrage", () => {
    // Vue énorme → CPM dépasserait 150, cappé par vidéo. Le cap est per-vidéo,
    // donc identique quel que soit le cycle qui la porte.
    const items = VIDS.map((v, i) => ({
      assignmentId: `a${i}`,
      snapshot: snap({ tauxCPM: 50 }), // 50 $/1000 vues → cap 150 vite atteint
      totalViews: v.totalViews,
      publishedAt: v.publishedAt,
    }));
    const totalGlobal = computeMonthlyPayout(items).total;
    const sumCycles = groupByCycle(items).reduce(
      (s, g) => s + computeMonthlyPayout(g).total,
      0,
    );
    expect(round2(sumCycles)).toBe(round2(totalGlobal));
  });
});
