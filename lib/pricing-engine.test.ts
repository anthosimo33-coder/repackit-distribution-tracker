import { describe, it, expect } from "vitest";
import {
  computeMonthlyPayout,
  assignmentCpm,
  assignmentBonus,
  type PricingSnapshot,
  type PayoutItem,
} from "./pricing-engine";

/** Pricing de référence : 100€ pour 60 vidéos, CPM 2€/1000, seuil 100k → bonus 50€. */
const P: PricingSnapshot = {
  pricingId: "p1",
  montantFixe: 100,
  nbVideosCible: 60,
  tauxCPM: 2,
  seuilBonusVues: 100_000,
  montantBonus: 50,
};

/** Génère n vidéos publiées avec un pricing + des vues données. */
function items(
  n: number,
  views: number,
  snapshot: PricingSnapshot = P,
  prefix = "a",
): PayoutItem[] {
  return Array.from({ length: n }, (_, i) => ({
    assignmentId: `${prefix}${i}`,
    snapshot,
    totalViews: views,
  }));
}

describe("pricing-engine — FIXE mensuel (réparti par vidéo unique, plafonné)", () => {
  it("30 vidéos publiées (100€/60) → 50€ de fixe", () => {
    const r = computeMonthlyPayout(items(30, 0));
    expect(r.fixedTotal).toBe(50); // 30 × (100/60=1,6667) = 50,00
  });

  it("60 vidéos → 100€ (cible atteinte)", () => {
    expect(computeMonthlyPayout(items(60, 0)).fixedTotal).toBe(100);
  });

  it("75 vidéos → 100€ (PLAFOND, pas 125€)", () => {
    expect(computeMonthlyPayout(items(75, 0)).fixedTotal).toBe(100);
  });

  it("nbVideosCible = 1 → fixePerVideo = montantFixe, plafond dès 1 vidéo", () => {
    const snap: PricingSnapshot = { ...P, nbVideosCible: 1 };
    expect(computeMonthlyPayout(items(1, 0, snap)).fixedTotal).toBe(100);
    expect(computeMonthlyPayout(items(3, 0, snap)).fixedTotal).toBe(100);
  });

  it("nbVideosCible invalide (0) → fixe 0 (garde anti division par zéro)", () => {
    const snap: PricingSnapshot = { ...P, nbVideosCible: 0 };
    expect(computeMonthlyPayout(items(5, 0, snap)).fixedTotal).toBe(0);
  });
});

describe("pricing-engine — CPM multi-plateforme", () => {
  it("une vidéo à 3000 (TikTok) + 2000 (YT) = 5000 vues @2€/1000 → 10€", () => {
    expect(assignmentCpm(P, 5000)).toBe(10);
    const r = computeMonthlyPayout([{ assignmentId: "a", snapshot: P, totalViews: 5000 }]);
    expect(r.cpmTotal).toBe(10);
  });

  it("CPM sommé sur plusieurs vidéos", () => {
    const r = computeMonthlyPayout([
      { assignmentId: "a", snapshot: P, totalViews: 5000 }, // 10€
      { assignmentId: "b", snapshot: P, totalViews: 1000 }, // 2€
    ]);
    expect(r.cpmTotal).toBe(12);
  });
});

describe("pricing-engine — BONUS au seuil (par vidéo)", () => {
  it("vidéo dépassant le seuil → +montantBonus UNE fois", () => {
    expect(assignmentBonus(P, 120_000)).toBe(50);
    expect(computeMonthlyPayout(items(1, 120_000)).bonusTotal).toBe(50);
  });

  it("vidéo sous le seuil → 0", () => {
    expect(assignmentBonus(P, 99_999)).toBe(0);
    expect(computeMonthlyPayout(items(1, 99_999)).bonusTotal).toBe(0);
  });

  it("seuil atteint exactement (>=) → bonus", () => {
    expect(assignmentBonus(P, 100_000)).toBe(50);
  });

  it("2 vidéos au-dessus du seuil → 2 × bonus", () => {
    expect(computeMonthlyPayout(items(2, 200_000)).bonusTotal).toBe(100);
  });
});

describe("pricing-engine — groupement par pricing + total", () => {
  it("2 pricings distincts → plafonds INDÉPENDANTS, sommés", () => {
    const q: PricingSnapshot = {
      pricingId: "p2",
      montantFixe: 60,
      nbVideosCible: 30, // fixePerVideo = 2
      tauxCPM: 1,
      seuilBonusVues: 50_000,
      montantBonus: 20,
    };
    const r = computeMonthlyPayout([
      ...items(75, 0, P, "p1v"), // fixe plafonné → 100
      ...items(40, 0, q, "p2v"), // 40×2=80 plafonné à 60
    ]);
    expect(r.fixedTotal).toBe(160); // 100 + 60 (indépendants)
    expect(r.perPricing).toHaveLength(2);
  });

  it("total = fixed + cpm + bonus, cas chiffré complet", () => {
    // 1 vidéo, 120k vues : fixe 1×1,6667=1,67 ; CPM 120×2=240 ; bonus 50.
    const r = computeMonthlyPayout(items(1, 120_000));
    expect(r.fixedTotal).toBe(1.67);
    expect(r.cpmTotal).toBe(240);
    expect(r.bonusTotal).toBe(50);
    expect(r.total).toBe(round(1.67 + 240 + 50));
    expect(r.total).toBe(291.67);
  });

  it("vidéo multi-plateforme = 1 item = 1 vidéo (compte une fois pour le fixe)", () => {
    // 60 vidéos chacune multi-plateforme → toujours 60 vidéos, fixe = 100.
    const r = computeMonthlyPayout(items(60, 5000));
    expect(r.perPricing[0].videoCount).toBe(60);
    expect(r.fixedTotal).toBe(100);
  });

  it("aucune vidéo → tout à 0", () => {
    const r = computeMonthlyPayout([]);
    expect(r).toMatchObject({ fixedTotal: 0, cpmTotal: 0, bonusTotal: 0, total: 0 });
    expect(r.perPricing).toHaveLength(0);
    expect(r.perAssignment).toHaveLength(0);
  });
});

const round = (n: number) => Math.round(n * 100) / 100;
