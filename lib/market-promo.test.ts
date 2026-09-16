import { describe, expect, it } from "vitest";
import { promoCostOfVideo, splitPromoByMarket } from "../convex/marketPromo";

describe("part promo d'une vidéo", () => {
  it("vidéo 100 % promo : tout le coût est promo", () => {
    expect(
      promoCostOfVideo({
        videoCost: 7.4,
        fixed: 2,
        cpm: 5.4,
        payableViews: 2700,
        promoPaidViews: 2700,
        hasPromoPost: true,
      }),
    ).toBe(7.4);
  });

  it("vidéo mixte avec un post warmup RÉMUNÉRÉ : le CPM warmup sort du coût promo", () => {
    // Fixe 2 $, CPM 6 $ gagné sur 3 000 vues payables dont 1 000 promo :
    // part promo = 2 + 6 × 1/3 = 4 $ sur 8 $.
    expect(
      promoCostOfVideo({
        videoCost: 8,
        fixed: 2,
        cpm: 6,
        payableViews: 3000,
        promoPaidViews: 1000,
        hasPromoPost: true,
      }),
    ).toBe(4);
  });

  it("le prorata s'applique au coût ENGAGÉ transmis, pas à fixe + CPM", () => {
    // Mois en cours : le moteur a réparti 4 $ engagés sur cette vidéo.
    expect(
      promoCostOfVideo({
        videoCost: 4,
        fixed: 2,
        cpm: 6,
        payableViews: 3000,
        promoPaidViews: 1000,
        hasPromoPost: true,
      }),
    ).toBe(2);
  });

  it("vidéo sans aucun post promo : zéro, même rémunérée", () => {
    expect(
      promoCostOfVideo({
        videoCost: 5,
        fixed: 2,
        cpm: 3,
        payableViews: 1500,
        promoPaidViews: 0,
        hasPromoPost: false,
      }),
    ).toBe(0);
  });
});

describe("répartition promo par marché", () => {
  it("coût et vues suivent les posts PROMO ; le warmup ne reçoit rien", () => {
    const parts = splitPromoByMarket(9, [
      { country: "FR", views: 2000, promo: true },
      { country: "RS", views: 1000, promo: true },
      { country: "GB", views: 50_000, promo: false },
    ]);
    expect(parts).toHaveLength(2);
    const fr = parts.find((p) => p.country === "FR")!;
    const rs = parts.find((p) => p.country === "RS")!;
    expect(fr).toEqual({ country: "FR", promoViews: 2000, promoCost: 6 });
    expect(rs).toEqual({ country: "RS", promoViews: 1000, promoCost: 3 });
    expect(parts.find((p) => p.country === "GB")).toBeUndefined();
  });

  it("deux posts promo du même pays s'additionnent", () => {
    const parts = splitPromoByMarket(4.5, [
      { country: "FR", views: 1234, promo: true },
      { country: "FR", views: 766, promo: true },
    ]);
    expect(parts).toEqual([{ country: "FR", promoViews: 2000, promoCost: 4.5 }]);
  });

  it("aucun post promo : aucune part", () => {
    expect(splitPromoByMarket(3, [{ country: "FR", views: 10, promo: false }])).toEqual([]);
  });
});
