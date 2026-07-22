import { describe, it, expect } from "vitest";
import {
  computeMonthlyPayout,
  assignmentCpm,
  estimateMissionEarnings,
  tiersOf,
  evaluateBonusTiers,
  payableAssignmentViews,
  type PricingSnapshot,
  type PayoutItem,
  type PublicationViews,
  type BonusTier,
} from "./pricing-engine";

/** Pricing de référence : fixe 100$/60 vidéos, CPM 2$/1000. */
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
  it("fixe : 30/60 → 50$, 60 → 100$, 75 → 100$ (plafond)", () => {
    expect(computeMonthlyPayout(items(30, 0)).fixedTotal).toBe(50);
    expect(computeMonthlyPayout(items(60, 0)).fixedTotal).toBe(100);
    expect(computeMonthlyPayout(items(75, 0)).fixedTotal).toBe(100);
  });

  it("CPM 3000+2000 = 5000 vues @2$/1000 → 10$", () => {
    expect(assignmentCpm(P, 5000)).toBe(10);
    expect(computeMonthlyPayout(items(1, 5000)).cpmTotal).toBe(10);
  });

  it("RÉGRESSION : une vidéo à 1M vues ne déclenche PLUS de bonus par vidéo", () => {
    const r = computeMonthlyPayout(items(1, 1_000_000)); // ex-seuil v1 = 100k
    // fixe (1/60≈1,67) + CPM (1000×2=2000) — AUCUN bonus ; CPM rogné par le
    // plafond 150 $/vidéo (2001,67 → 150 ; cf describe « plafond »).
    expect(r.fixedTotal).toBe(1.67);
    expect(r.cpmTotal).toBe(148.33);
    expect(r.total).toBe(150);
    expect("bonusTotal" in r).toBe(false);
  });

  it("total = fixe + CPM (round2), pas vide", () => {
    const r = computeMonthlyPayout(items(1, 120_000));
    expect(r.total).toBe(round(r.fixedTotal + r.cpmTotal));
  });
});

describe("plafond 150 $/vidéo — computeMonthlyPayout (global tous projets)", () => {
  // Part fixe RONDE (120/60 = 2 $/vidéo) → totaux nets pour les assertions.
  const P2: PricingSnapshot = {
    ...P,
    montantFixe: 120,
    nbVideosCible: 60,
    tauxCPM: 2,
  };

  it("une vidéo dont le calcul dépasse 150 $ → capée à 150 $", () => {
    // fixe 2 + CPM (1000×2=2000) = 2002 → 150.
    expect(computeMonthlyPayout(items(1, 1_000_000, P2)).total).toBe(150);
  });

  it("122M vues → 150 $ (exemple fondateur)", () => {
    expect(computeMonthlyPayout(items(1, 122_000_000, P2)).total).toBe(150);
  });

  it("une vidéo SOUS 150 $ → calcul inchangé (CPM normal)", () => {
    // fixe 2 + CPM (5×2=10) = 12.
    expect(computeMonthlyPayout(items(1, 5000, P2)).total).toBe(12);
  });

  it("total = SOMME des vidéos DÉJÀ capées (cap PAR vidéo, pas sur le total)", () => {
    // 3 vidéos > 150 chacune → 450, JAMAIS capé à 150 globalement.
    expect(computeMonthlyPayout(items(3, 1_000_000, P2)).total).toBe(450);
  });

  it("mix : une vidéo capée (150) + une sous le plafond (fixe 2) → 152", () => {
    const mix = [
      ...items(1, 1_000_000, P2, "hi"),
      ...items(1, 0, P2, "lo"),
    ];
    expect(computeMonthlyPayout(mix).total).toBe(152);
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

  it("cas chiffré 2,3M : iPhone franchi (nature, HORS total $), 5M non atteint", () => {
    const r = evaluateBonusTiers(2_300_000, TIERS);
    expect(r.crossed).toHaveLength(1);
    expect(r.natureCrossed.map((t) => t.libelle)).toEqual(["iPhone"]);
    expect(r.cashCrossedTotal).toBe(0); // l'iPhone ne compte pas en $
    expect(r.nextTier?.montant).toBe(500);
    expect(r.viewsToNext).toBe(2_700_000);
  });

  it("cas chiffré 5,1M : iPhone + 500$ franchis → cash 500$, MacBook prochain", () => {
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
  // Pricing réel « Deal Créateur Face cam » (prod) : fixe 100$/60 vidéos, CPM 1,1.
  const DEAL: PricingSnapshot = {
    pricingId: "deal",
    montantFixe: 100,
    nbVideosCible: 60,
    tauxCPM: 1.1,
    seuilBonusVues: 0,
    montantBonus: 0,
  };

  it("fixe/vidéo + CPM ; ex. Marielle à 10k vues ≈ 12,67$ (et non 0$)", () => {
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

  it("plafond 150 $/vidéo : estimation > 150 → capée (fixe gardé, CPM rogné)", () => {
    // CPM 1,1 × 1M/1000 = 1100 + fixe 1,67 → 1101,67 → 150.
    const e = estimateMissionEarnings(DEAL, 1_000_000);
    expect(e.total).toBe(150);
    expect(e.fixed).toBe(1.67);
    expect(e.cpm).toBe(148.33);
  });
});

describe("payableAssignmentViews — exclusion warmup (par POST)", () => {
  it("vidéo tout-warmup : payableViews 0, hasPayablePost false (exclue du fixe)", () => {
    const r = payableAssignmentViews([{ views: 100_000, isWarmup: true }]);
    expect(r).toEqual({ payableViews: 0, hasPayablePost: false });
  });

  it("aucun warmup : payableViews == Σ vues, hasPayablePost true → INCHANGÉ", () => {
    const r = payableAssignmentViews([
      { views: 5_000, isWarmup: false },
      { views: 3_000, isWarmup: false },
    ]);
    expect(r).toEqual({ payableViews: 8_000, hasPayablePost: true });
  });

  it("partiel : seules les vues NON-warmup comptent, la vidéo reste payable", () => {
    const r = payableAssignmentViews([
      { views: 5_000, isWarmup: false },
      { views: 100_000, isWarmup: true },
    ]);
    expect(r).toEqual({ payableViews: 5_000, hasPayablePost: true });
  });

  it("vidéo sans post (edge legacy) : compte pour le fixe (historique préservé)", () => {
    expect(payableAssignmentViews([])).toEqual({
      payableViews: 0,
      hasPayablePost: true,
    });
  });
});

describe("warmup — un post warmup n'ajoute NI fixe, NI CPM, NI cumul palier", () => {
  const TIERS: BonusTier[] = [
    { seuilVues: 2_000_000, rewardType: "nature", libelle: "iPhone" },
    { seuilVues: 5_000_000, rewardType: "cash", montant: 500 },
  ];

  /**
   * Réplique la composition SERVEUR (convex/pricing) : chaque vidéo → vues
   * payables ; une vidéo tout-warmup est EXCLUE des items (donc du fixe) ; le
   * cumul de paliers = Σ des vues payables. C'est ce pipeline que le warmup doit
   * neutraliser.
   */
  function buildPay(
    videos: { snapshot: PricingSnapshot; pubs: PublicationViews[] }[],
  ): { payout: ReturnType<typeof computeMonthlyPayout>; cumul: number } {
    const payoutItems: PayoutItem[] = [];
    let cumul = 0;
    videos.forEach((vd, i) => {
      const { payableViews, hasPayablePost } = payableAssignmentViews(vd.pubs);
      cumul += payableViews;
      if (hasPayablePost) {
        payoutItems.push({
          assignmentId: `a${i}`,
          snapshot: vd.snapshot,
          totalViews: payableViews,
        });
      }
    });
    return { payout: computeMonthlyPayout(payoutItems), cumul };
  }

  it("vidéo entièrement warmup : 0 fixe, 0 CPM, 0 cumul, aucun palier franchi", () => {
    const { payout, cumul } = buildPay([
      { snapshot: P, pubs: [{ views: 3_000_000, isWarmup: true }] },
    ]);
    expect(payout.fixedTotal).toBe(0);
    expect(payout.cpmTotal).toBe(0);
    expect(payout.total).toBe(0);
    expect(cumul).toBe(0);
    // Même 3M de vues warmup ne débloquent AUCUN palier.
    expect(evaluateBonusTiers(cumul, TIERS).crossed).toHaveLength(0);
  });

  it("preuve a contrario : la MÊME vidéo NON-warmup paie et cumule bien", () => {
    const { payout, cumul } = buildPay([
      { snapshot: P, pubs: [{ views: 3_000_000, isWarmup: false }] },
    ]);
    expect(payout.fixedTotal).toBeGreaterThan(0);
    expect(payout.cpmTotal).toBeGreaterThan(0);
    expect(cumul).toBe(3_000_000);
    // 3M franchit le palier iPhone (2M) — que le warmup ci-dessus supprimait.
    expect(evaluateBonusTiers(cumul, TIERS).crossed).toHaveLength(1);
  });

  it("partiel : fixe compté UNE fois, CPM sur les seules vues payables (5000)", () => {
    const { payout, cumul } = buildPay([
      {
        snapshot: P,
        pubs: [
          { views: 5_000, isWarmup: false },
          { views: 100_000, isWarmup: true },
        ],
      },
    ]);
    // fixe = 1 vidéo × 100/60 = 1,67 (la vidéo reste payante).
    expect(payout.fixedTotal).toBe(1.67);
    // CPM sur 5000 vues (@2€/1000) = 10 — les 100k warmup sont EXCLUES.
    expect(payout.cpmTotal).toBe(10);
    // Cumul de paliers = 5000 (warmup exclu), pas 105 000.
    expect(cumul).toBe(5_000);
  });

  it("cumul multi-vidéos : les vues warmup ne franchissent pas le palier", () => {
    // 1,5M payable + 1,5M warmup. Sans warmup on serait à 3M (> 2M = iPhone) ;
    // avec, le cumul reste 1,5M → aucun palier.
    const { cumul } = buildPay([
      { snapshot: P, pubs: [{ views: 1_500_000, isWarmup: false }] },
      { snapshot: P, pubs: [{ views: 1_500_000, isWarmup: true }] },
    ]);
    expect(cumul).toBe(1_500_000);
    expect(evaluateBonusTiers(cumul, TIERS).crossed).toHaveLength(0);
  });
});
