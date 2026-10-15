import { describe, expect, it } from "vitest";
import {
  promoCostOfVideo,
  splitPrimeByMarket,
  splitPromoByMarket,
} from "../convex/marketPromo";

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

describe("bonus par vidéo dans le coût promo", () => {
  it("vidéo au-delà du budget fixe, barème sans CPM : son bonus reste un coût promo", () => {
    // Cas Lorena (octobre 2026) : 40 € de fixe pour 4 vidéos, 0 CPM, bonus par
    // vidéo. La 5e vidéo n'a plus ni fixe ni CPM au moteur, seulement ses 50 €
    // de bonus : l'onglet Pays la comptait à 0.
    expect(
      promoCostOfVideo({
        videoCost: 50,
        fixed: 0,
        cpm: 0,
        bonus: 50,
        payableViews: 61_388,
        promoPaidViews: 61_388,
        hasPromoPost: true,
      }),
    ).toBe(50);
  });

  it("vidéo mixte : le prorata touche fixe + CPM, jamais le bonus", () => {
    // Fixe 1,6667 $, CPM 12,48 $ sur 8 214 vues payables dont 5 902 promo,
    // bonus 30 $. Part promo du couple = 10,63 $ ; le bonus, gagné sur des vues
    // promo, entre en entier : 10,63 + 30 = 40,63 $ (et non 44,15 × 0,75).
    expect(
      promoCostOfVideo({
        videoCost: 44.1467,
        fixed: 1.6667,
        cpm: 12.48,
        bonus: 30,
        payableViews: 8_214,
        promoPaidViews: 5_902,
        hasPromoPost: true,
      }),
    ).toBe(40.63);
  });

  it("vidéo 100 % warmup : zéro, même avec un bonus", () => {
    expect(
      promoCostOfVideo({
        videoCost: 50,
        fixed: 0,
        cpm: 0,
        bonus: 50,
        payableViews: 61_388,
        promoPaidViews: 0,
        hasPromoPost: false,
      }),
    ).toBe(0);
  });
});

describe("prime créatrice (palier, défi) répartie par marché", () => {
  it("suit la part de chaque marché dans ses vues PROMO ; le warmup ne reçoit rien", () => {
    // Forme du palier de Kelly (200 $, septembre 2026) : deux vidéos FR, une BE,
    // un post warmup GB très vu qui ne fait pas avancer un palier.
    const parts = splitPrimeByMarket(200, [
      { country: "FR", views: 412_337, promo: true },
      { country: "FR", views: 98_211, promo: true },
      { country: "BE", views: 31_642, promo: true },
      { country: "GB", views: 220_000, promo: false },
    ]);
    expect(parts).toEqual([
      { country: "FR", cost: 188.33 },
      { country: "BE", cost: 11.67 },
    ]);
    // Le total recolle à la prime, au centime.
    expect(parts.reduce((s, p) => s + p.cost, 0)).toBeCloseTo(200, 2);
  });

  it("un seul marché : toute la prime y va", () => {
    expect(
      splitPrimeByMarket(187.5, [
        { country: "FR", views: 63_418, promo: true },
        { country: "FR", views: 0, promo: true },
      ]),
    ).toEqual([{ country: "FR", cost: 187.5 }]);
  });

  it("aucun post promo : la prime reste visible sur « non défini »", () => {
    expect(
      splitPrimeByMarket(200, [{ country: "FR", views: 31_260, promo: false }]),
    ).toEqual([{ country: null, cost: 200 }]);
  });

  it("prime nulle : aucune part", () => {
    expect(splitPrimeByMarket(0, [{ country: "FR", views: 10, promo: true }])).toEqual([]);
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
