import { describe, it, expect } from "vitest";
import {
  computeMonthlyPayout,
  assignmentCpm,
  estimateMissionEarnings,
  tiersOf,
  evaluateBonusTiers,
  type PricingSnapshot,
  type PayoutItem,
  type BonusTier,
} from "./pricing-engine";

/** Pricing de référence : fixe 100€/60 vidéos, CPM 2€/1000. */
const P: PricingSnapshot = {
  pricingId: "p1",
  montantFixe: 100,
  nbVideosCible: 60,
  tauxCPM: 2,
  // legacy v1 (ignoré par le moteur v2) :
  seuilBonusVues: 100_000,
  montantBonus: 50,
};

function items(n: number, views: number, snapshot = P, prefix = "a"): PayoutItem[] {
  return Array.from({ length: n }, (_, i) => ({
    assignmentId: `${prefix}${i}`,
    snapshot,
    totalViews: views,
  }));
}

describe("computeMonthlyPayout — FIXE + CPM (v2, sans bonus par vidéo)", () => {
  it("fixe : 30/60 → 50€, 60 → 100€, 75 → 100€ (plafond)", () => {
    expect(computeMonthlyPayout(items(30, 0)).fixedTotal).toBe(50);
    expect(computeMonthlyPayout(items(60, 0)).fixedTotal).toBe(100);
    expect(computeMonthlyPayout(items(75, 0)).fixedTotal).toBe(100);
  });

  it("CPM 3000+2000 = 5000 vues @2€/1000 → 10€", () => {
    expect(assignmentCpm(P, 5000)).toBe(10);
    expect(computeMonthlyPayout(items(1, 5000)).cpmTotal).toBe(10);
  });

  it("RÉGRESSION : une vidéo à 1M vues ne déclenche PLUS de bonus par vidéo", () => {
    const r = computeMonthlyPayout(items(1, 1_000_000)); // ex-seuil v1 = 100k
    // total = fixe (1/60≈1,67) + CPM (1000×2=2000) — AUCUN bonus.
    expect(r.fixedTotal).toBe(1.67);
    expect(r.cpmTotal).toBe(2000);
    expect(r.total).toBe(2001.67);
    expect("bonusTotal" in r).toBe(false);
  });

  it("total = fixe + CPM (round2), pas vide", () => {
    const r = computeMonthlyPayout(items(1, 120_000));
    expect(r.total).toBe(round(r.fixedTotal + r.cpmTotal));
  });
});

describe("tiersOf — grille + fallback legacy", () => {
  it("bonusTiers présent → renvoyé tel quel", () => {
    const tiers: BonusTier[] = [
      { seuilVues: 2_000_000, rewardType: "nature", libelle: "iPhone" },
      { seuilVues: 5_000_000, rewardType: "cash", montant: 500 },
    ];
    expect(tiersOf({ bonusTiers: tiers })).toEqual(tiers);
  });

  it("legacy (seuilBonusVues+montantBonus, pas de bonusTiers) → 1 palier cash", () => {
    expect(tiersOf({ seuilBonusVues: 100_000, montantBonus: 50 })).toEqual([
      { seuilVues: 100_000, rewardType: "cash", montant: 50 },
    ]);
  });

  it("ni tiers ni legacy → []", () => {
    expect(tiersOf({})).toEqual([]);
    expect(tiersOf({ seuilBonusVues: 0, montantBonus: 0 })).toEqual([]);
  });
});

describe("evaluateBonusTiers — cumul créateur", () => {
  const TIERS: BonusTier[] = [
    { seuilVues: 2_000_000, rewardType: "nature", libelle: "iPhone" },
    { seuilVues: 5_000_000, rewardType: "cash", montant: 500 },
    { seuilVues: 10_000_000, rewardType: "nature", libelle: "MacBook" },
  ];

  it("cumul sous tous les paliers → rien franchi, jauge vers le 1er", () => {
    const r = evaluateBonusTiers(1_500_000, TIERS);
    expect(r.crossed).toEqual([]);
    expect(r.cashCrossedTotal).toBe(0);
    expect(r.nextTier?.libelle).toBe("iPhone");
    expect(r.viewsToNext).toBe(500_000);
  });

  it("cas chiffré 2,3M : iPhone franchi (nature, HORS total €), 5M non atteint", () => {
    const r = evaluateBonusTiers(2_300_000, TIERS);
    expect(r.crossed).toHaveLength(1);
    expect(r.natureCrossed.map((t) => t.libelle)).toEqual(["iPhone"]);
    expect(r.cashCrossedTotal).toBe(0); // l'iPhone ne compte pas en €
    expect(r.nextTier?.montant).toBe(500);
    expect(r.viewsToNext).toBe(2_700_000);
  });

  it("cas chiffré 5,1M : iPhone + 500€ franchis → cash 500€, MacBook prochain", () => {
    const r = evaluateBonusTiers(5_100_000, TIERS);
    expect(r.crossed).toHaveLength(2);
    expect(r.cashCrossedTotal).toBe(500);
    expect(r.natureCrossed.map((t) => t.libelle)).toEqual(["iPhone"]);
    expect(r.nextTier?.libelle).toBe("MacBook");
  });

  it("cumul == seuil exact → franchi (>=)", () => {
    expect(evaluateBonusTiers(2_000_000, TIERS).crossed).toHaveLength(1);
  });

  it("paliers non triés en entrée → évaluation triée déterministe", () => {
    const unsorted: BonusTier[] = [
      { seuilVues: 5_000_000, rewardType: "cash", montant: 500 },
      { seuilVues: 2_000_000, rewardType: "nature", libelle: "iPhone" },
    ];
    const r = evaluateBonusTiers(2_300_000, unsorted);
    expect(r.crossed).toHaveLength(1);
    expect(r.crossed[0].libelle).toBe("iPhone");
    expect(r.nextTier?.montant).toBe(500);
  });

  it("aucun palier → tout vide", () => {
    const r = evaluateBonusTiers(9_999_999, []);
    expect(r).toMatchObject({
      crossed: [],
      cashCrossedTotal: 0,
      natureCrossed: [],
      nextTier: null,
      viewsToNext: null,
    });
  });

  it("palier cash sans montant (malformé) → 0, pas de NaN", () => {
    const r = evaluateBonusTiers(3_000_000, [
      { seuilVues: 2_000_000, rewardType: "cash" },
    ]);
    expect(r.cashCrossedTotal).toBe(0);
    expect(Number.isNaN(r.cashCrossedTotal)).toBe(false);
  });
});

const round = (n: number) => Math.round(n * 100) / 100;

describe("estimateMissionEarnings — fiche mission (fixe/vidéo + CPM, sans bonus)", () => {
  // Pricing réel « Deal Créateur Face cam » (prod) : fixe 100€/60 vidéos, CPM 1,1.
  const DEAL: PricingSnapshot = {
    pricingId: "deal",
    montantFixe: 100,
    nbVideosCible: 60,
    tauxCPM: 1.1,
    seuilBonusVues: 0,
    montantBonus: 0,
  };

  it("fixe/vidéo + CPM ; ex. Marielle à 10k vues ≈ 12,67€ (et non 0€)", () => {
    const e = estimateMissionEarnings(DEAL, 10_000);
    expect(e.fixed).toBe(1.67); // 100 / 60
    expect(e.cpm).toBe(11); // 10 × 1,1
    expect(e.total).toBe(12.67);
  });

  it("le slider (vues) pilote la part CPM → l'estimation varie", () => {
    const at0 = estimateMissionEarnings(DEAL, 0);
    const at50k = estimateMissionEarnings(DEAL, 50_000);
    // À 0 vue : pas de CPM, total = fixe seul.
    expect(at0.cpm).toBe(0);
    expect(at0.total).toBe(at0.fixed);
    // Plus de vues → plus de CPM → total strictement supérieur.
    expect(at50k.cpm).toBe(55); // 50 × 1,1
    expect(at50k.total).toBeGreaterThan(at0.total);
    expect(at50k.cpm).toBe(assignmentCpm(DEAL, 50_000));
  });

  it("garde anti /0 : nbVideosCible invalide → fixe 0 (CPM seul)", () => {
    const bad: PricingSnapshot = { ...DEAL, nbVideosCible: 0 };
    const e = estimateMissionEarnings(bad, 10_000);
    expect(e.fixed).toBe(0);
    expect(e.total).toBe(11);
  });
});
