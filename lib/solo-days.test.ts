import { describe, it, expect } from "vitest";
import {
  computeSoloDays,
  computeCreatorEfficiency,
  HIT_VIEWS_THRESHOLD,
  type PromoVideo,
} from "../convex/soloDays";

describe("computeSoloDays", () => {
  const videos: PromoVideo[] = [
    { day: "2026-07-28", creatorId: "sarah", creatorName: "Sarah", promoViews: 4210 },
    { day: "2026-07-27", creatorId: "kelly", creatorName: "Kelly", promoViews: 15549 },
    { day: "2026-07-26", creatorId: "kelly", creatorName: "Kelly", promoViews: 8000 },
    { day: "2026-07-26", creatorId: "sarah", creatorName: "Sarah", promoViews: 5800 },
    { day: "2026-07-25", creatorId: "kelly", creatorName: "Kelly", promoViews: 1000 },
  ];
  const daily = [
    { day: "2026-07-28", visitors: 61, signups: 44, clients: 3 },
    { day: "2026-07-27", visitors: 254, signups: 180, clients: 9 },
    // 26 et 25 absents de la série PostHog
  ];
  const days = computeSoloDays(videos, daily);

  it("trie du plus récent au plus ancien", () => {
    expect(days.map((d) => d.day)).toEqual([
      "2026-07-28",
      "2026-07-27",
      "2026-07-26",
      "2026-07-25",
    ]);
  });

  it("attribue le comportement du jour à la créatrice sur un jour SOLO", () => {
    const d28 = days.find((d) => d.day === "2026-07-28")!;
    expect(d28.isSolo).toBe(true);
    expect(d28.attribution).toEqual({
      creatorId: "sarah",
      creatorName: "Sarah",
      visitors: 61,
      signups: 44,
      clients: 3,
    });
  });

  it("N'attribue RIEN sur un jour multi-créatrices (non attribuable)", () => {
    const d26 = days.find((d) => d.day === "2026-07-26")!;
    expect(d26.isSolo).toBe(false);
    expect(d26.attribution).toBeNull();
    expect(d26.promoViews).toBe(13800); // 8000 + 5800
    expect(d26.creators).toHaveLength(2);
  });

  it("jour solo hors série PostHog → attribution avec compteurs null (jamais 0)", () => {
    const d25 = days.find((d) => d.day === "2026-07-25")!;
    expect(d25.isSolo).toBe(true);
    expect(d25.attribution).toMatchObject({
      creatorName: "Kelly",
      visitors: null,
      signups: null,
      clients: null,
    });
  });

  it("agrège plusieurs vidéos d'une même créatrice le même jour sans casser le solo", () => {
    const multi = computeSoloDays(
      [
        { day: "2026-07-20", creatorId: "kelly", creatorName: "Kelly", promoViews: 100 },
        { day: "2026-07-20", creatorId: "kelly", creatorName: "Kelly", promoViews: 200 },
      ],
      [{ day: "2026-07-20", visitors: 10, signups: 5, clients: 1 }],
    );
    expect(multi[0].isSolo).toBe(true);
    expect(multi[0].creators[0]).toMatchObject({ videos: 2, promoViews: 300 });
    expect(multi[0].attribution?.signups).toBe(5);
  });
});

describe("computeCreatorEfficiency", () => {
  const videos: PromoVideo[] = [
    { day: "d1", creatorId: "kelly", creatorName: "Kelly", promoViews: 1000 },
    { day: "d2", creatorId: "kelly", creatorName: "Kelly", promoViews: 8000 },
    { day: "d3", creatorId: "kelly", creatorName: "Kelly", promoViews: 15549 },
    { day: "d4", creatorId: "kelly", creatorName: "Kelly", promoViews: 60000 },
    { day: "d1", creatorId: "sarah", creatorName: "Sarah", promoViews: 4210 },
    { day: "d2", creatorId: "sarah", creatorName: "Sarah", promoViews: 5800 },
  ];
  const eff = computeCreatorEfficiency(videos);

  it("classe par vues promo décroissantes", () => {
    expect(eff.map((e) => e.creatorId)).toEqual(["kelly", "sarah"]);
  });

  it("médiane paire = moyenne arrondie des deux centraux ; hit = vidéos > seuil", () => {
    const kelly = eff.find((e) => e.creatorId === "kelly")!;
    expect(kelly.videos).toBe(4);
    expect(kelly.promoViews).toBe(84549);
    // [1000, 8000, 15549, 60000] → (8000 + 15549) / 2 = 11774.5 → 11775
    expect(kelly.medianViews).toBe(11775);
    expect(kelly.hitCount).toBe(1); // seul 60000 > 50000
    expect(HIT_VIEWS_THRESHOLD).toBe(50000);
  });

  it("médiane impaire = valeur centrale", () => {
    const sarah = eff.find((e) => e.creatorId === "sarah")!;
    // [4210, 5800] → (4210 + 5800)/2 = 5005
    expect(sarah.medianViews).toBe(5005);
    expect(sarah.hitCount).toBe(0);
  });
});
