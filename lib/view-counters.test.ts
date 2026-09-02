import { describe, it, expect } from "vitest";
import {
  viewsSplitOf,
  isPromoPost,
  isBonusTierPost,
  computeViewCounters,
  VIEW_COUNTER_USAGE,
} from "../convex/viewCounters";

/**
 * Verrou de la règle A2 : quatre compteurs distincts, JAMAIS additionnés, et
 * `payables ≠ promo ≠ paliers` dès qu'un post est warmup ET rémunéré (« cas
 * Kelly ») — il est payé au fixe/CPM mais ne fait pas avancer les paliers.
 */
describe("isPromoPost", () => {
  it("promo = non-warmup (point de décision unique)", () => {
    expect(isPromoPost({ isWarmup: false })).toBe(true);
    expect(isPromoPost({ isWarmup: true })).toBe(false);
  });
});

describe("isBonusTierPost", () => {
  it("paliers = rémunéré ET promo (les deux, pas l'un ou l'autre)", () => {
    expect(isBonusTierPost({ isWarmup: false })).toBe(true);
    // Cas Kelly : payé mais hors promo → ne fait PAS avancer les paliers.
    expect(isBonusTierPost({ isWarmup: true, remunere: true })).toBe(false);
    // Chauffe pure : ni payé ni promo.
    expect(isBonusTierPost({ isWarmup: true })).toBe(false);
    // Promo mais explicitement non rémunéré → pas de palier non plus.
    expect(isBonusTierPost({ isWarmup: false, remunere: false })).toBe(false);
  });
});

describe("computeViewCounters", () => {
  it("sans warmup : les quatre compteurs coïncident", () => {
    const c = computeViewCounters([
      { views: 1000, isWarmup: false },
      { views: 500, isWarmup: false },
    ]);
    expect(c).toEqual({
      totales: 1500,
      payables: 1500,
      promo: 1500,
      paliers: 1500,
    });
  });

  it("cas Kelly (warmup + rémunéré) : payable OUI, promo NON, palier NON", () => {
    const c = computeViewCounters([
      { views: 1000, isWarmup: false }, // normal → les quatre
      { views: 500, isWarmup: true, remunere: true }, // Kelly → payable seul
      { views: 200, isWarmup: true }, // chauffe pure → totales seul
    ]);
    expect(c.totales).toBe(1700);
    expect(c.payables).toBe(1500); // 1000 + 500 (Kelly rémunéré)
    expect(c.promo).toBe(1000); // 1000 (seul non-warmup)
    expect(c.paliers).toBe(1000); // rémunéré ET promo
    expect(c.payables).not.toBe(c.promo);
    // LE verrou du chantier : les vues de Kelly sont payées mais ne font pas
    // avancer son palier. Régresser ici, c'est repayer du bonus sur du warmup.
    expect(c.paliers).toBeLessThan(c.payables);
  });

  it("paliers est borné par payables ET par promo, dans tous les cas", () => {
    const c = computeViewCounters([
      { views: 300, isWarmup: false },
      { views: 400, isWarmup: true, remunere: true },
      { views: 100, isWarmup: false, remunere: false },
      { views: 50, isWarmup: true },
    ]);
    expect(c.paliers).toBeLessThanOrEqual(c.payables);
    expect(c.paliers).toBeLessThanOrEqual(c.promo);
    expect(c.paliers).toBe(300);
  });

  it("totales borne les autres mais n'en est PAS la somme (non additifs)", () => {
    const c = computeViewCounters([
      { views: 100, isWarmup: false },
      { views: 100, isWarmup: false },
      { views: 100, isWarmup: false },
    ]);
    expect(c.totales).toBeGreaterThanOrEqual(c.payables);
    expect(c.totales).toBeGreaterThanOrEqual(c.promo);
    expect(c.totales).toBeGreaterThanOrEqual(c.paliers);
    // 300 ≠ 300 + 300 : additionner payables et promo double-compterait.
    expect(c.totales).not.toBe(c.payables + c.promo);
  });

  it("vues négatives ramenées à 0 ; liste vide = tout à 0", () => {
    expect(computeViewCounters([{ views: -50, isWarmup: false }]).totales).toBe(0);
    expect(computeViewCounters([])).toEqual({
      totales: 0,
      payables: 0,
      promo: 0,
      paliers: 0,
    });
  });

  it("expose un libellé d'usage pour CHAQUE compteur (la carte déclare lequel)", () => {
    expect(VIEW_COUNTER_USAGE.totales).toMatch(/affichage/i);
    expect(VIEW_COUNTER_USAGE.payables).toMatch(/cpm/i);
    expect(VIEW_COUNTER_USAGE.promo).toMatch(/conversion/i);
    expect(VIEW_COUNTER_USAGE.paliers).toMatch(/palier/i);
  });
});

/**
 * VENTILATION du RPM — la coupure est FINANCIÈRE, pas éditoriale.
 *
 * Les cas ci-dessous sont ceux de la prod du 2026-09-02 (projet snytch), pas des
 * nombres ronds : c'est en retirant de la paie un post NON-warmup de 271 100 vues
 * que le défaut est apparu — la carte Rentabilité le comptait toujours comme
 * monétisé, donc le RPM business ne bougeait pas.
 */
describe("viewsSplitOf", () => {
  it("sort de `paidViews` un post NON-warmup retiré de la paie", () => {
    const split = viewsSplitOf([
      { isWarmup: false, remunere: false, views: 271_100 }, // retiré à la main
      { isWarmup: false, views: 304 }, // l'autre post de la même vidéo
    ]);
    expect(split.paidViews).toBe(304);
    expect(split.unpaidViews).toBe(271_100);
  });

  it("GARDE le post warmup explicitement PAYÉ dans `paidViews` (cas Kelly)", () => {
    // Contre-test : une implémentation qui se contenterait de `!isWarmup` sortirait
    // ce post, alors qu'il est bel et bien payé. Les deux sens comptent.
    const split = viewsSplitOf([{ isWarmup: true, remunere: true, views: 262_200 }]);
    expect(split.paidViews).toBe(262_200);
    expect(split.unpaidViews).toBe(0);
  });

  it("sans drapeau explicite, retombe sur le warmup (aucune régression)", () => {
    const split = viewsSplitOf([
      { isWarmup: false, views: 1_715 },
      { isWarmup: true, views: 112_200 },
    ]);
    expect(split.paidViews).toBe(1_715);
    expect(split.unpaidViews).toBe(112_200);
  });

  it("les deux parts sont une PARTITION des vues totales", () => {
    const items = [
      { isWarmup: false, remunere: false, views: 1_639 },
      { isWarmup: true, remunere: true, views: 33 },
      { isWarmup: true, views: 59_000 },
      { isWarmup: false, views: 12_100 },
    ];
    const split = viewsSplitOf(items);
    const { totales } = computeViewCounters(items);
    expect(split.paidViews + split.unpaidViews).toBe(totales);
    expect(totales).toBe(72_772);
  });
});
