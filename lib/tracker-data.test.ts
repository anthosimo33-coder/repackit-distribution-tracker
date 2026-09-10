import { describe, it, expect } from "vitest";
import {
  engagementRate,
  computeGlobalStats,
  aggregateByCategory,
  matchesDimensionFilters,
  matchesWarmupFilter,
  DEFAULT_WARMUP_FILTER,
  type CategoryItem,
  type PostDimensions,
} from "./tracker-data";

describe("matchesWarmupFilter", () => {
  it("exclut les posts warmup par défaut", () => {
    expect(DEFAULT_WARMUP_FILTER).toBe("exclude");
    expect(matchesWarmupFilter(true, "exclude")).toBe(false);
    expect(matchesWarmupFilter(false, "exclude")).toBe(true);
  });

  it("laisse tout passer en mode « Tous »", () => {
    expect(matchesWarmupFilter(true, "all")).toBe(true);
    expect(matchesWarmupFilter(false, "all")).toBe(true);
  });

  it("ne garde que le warmup en mode « Warmup seulement »", () => {
    expect(matchesWarmupFilter(true, "only")).toBe(true);
    expect(matchesWarmupFilter(false, "only")).toBe(false);
  });

  it("partitionne strictement : exclude et only sont complémentaires", () => {
    for (const isWarmup of [true, false]) {
      expect(matchesWarmupFilter(isWarmup, "exclude")).toBe(
        !matchesWarmupFilter(isWarmup, "only"),
      );
    }
  });
});

describe("matchesDimensionFilters", () => {
  const base: PostDimensions = {
    creatorId: "c1",
    compte: "@a",
    plateforme: "TikTok",
    formatId: "f1",
    campaignId: "camp1",
  };

  it("no filters → always matches", () => {
    expect(matchesDimensionFilters(base, {})).toBe(true);
    expect(
      matchesDimensionFilters(base, { creatorIds: [], plateformes: [] }),
    ).toBe(true);
  });

  it("OR within a dimension (membership)", () => {
    expect(
      matchesDimensionFilters(base, { creatorIds: ["c1", "c2"] }),
    ).toBe(true);
    expect(
      matchesDimensionFilters(base, { creatorIds: ["c2", "c3"] }),
    ).toBe(false);
  });

  it("AND across dimensions", () => {
    // (c1 OR c2) AND (TikTok) → matches
    expect(
      matchesDimensionFilters(base, {
        creatorIds: ["c1", "c2"],
        plateformes: ["TikTok"],
      }),
    ).toBe(true);
    // creator matches but platform doesn't → excluded
    expect(
      matchesDimensionFilters(base, {
        creatorIds: ["c1"],
        plateformes: ["YouTube"],
      }),
    ).toBe(false);
  });

  it("null dimension value never matches an active filter", () => {
    const noCreator: PostDimensions = { ...base, creatorId: null };
    expect(matchesDimensionFilters(noCreator, { creatorIds: ["c1"] })).toBe(
      false,
    );
    // but still visible when that dimension is inactive
    expect(matchesDimensionFilters(noCreator, { plateformes: ["TikTok"] })).toBe(
      true,
    );
  });

  it("post without a named format excluded only when format filter active", () => {
    const noFormat: PostDimensions = { ...base, formatId: null };
    expect(matchesDimensionFilters(noFormat, { formatIds: ["f1"] })).toBe(false);
    expect(matchesDimensionFilters(noFormat, {})).toBe(true);
  });

  it("compte / campaign membership", () => {
    expect(matchesDimensionFilters(base, { comptes: ["@a", "@b"] })).toBe(true);
    expect(matchesDimensionFilters(base, { comptes: ["@b"] })).toBe(false);
    expect(matchesDimensionFilters(base, { campaignIds: ["camp1"] })).toBe(true);
    expect(matchesDimensionFilters(base, { campaignIds: ["camp2"] })).toBe(
      false,
    );
  });

  it("all dimensions active and all match", () => {
    expect(
      matchesDimensionFilters(base, {
        creatorIds: ["c1"],
        comptes: ["@a"],
        plateformes: ["TikTok"],
        formatIds: ["f1"],
        campaignIds: ["camp1"],
      }),
    ).toBe(true);
  });
});

describe("engagementRate", () => {
  it("(likes + comments) / vues", () => {
    expect(engagementRate(10, 5, 100)).toBeCloseTo(0.15, 10);
  });
  it("returns null when vues <= 0", () => {
    expect(engagementRate(10, 5, 0)).toBeNull();
    expect(engagementRate(0, 0, -3)).toBeNull();
  });
  it("0 likes + 0 comments → 0 (not null) when vues > 0", () => {
    expect(engagementRate(0, 0, 50)).toBe(0);
  });
});

describe("computeGlobalStats", () => {
  it("sums metrics and aggregates engagement on the sums", () => {
    const stats = computeGlobalStats([
      { vues: 100, likes: 10, comments: 5 },
      { vues: 300, likes: 20, comments: 10 },
    ]);
    expect(stats.vues).toBe(400);
    expect(stats.likes).toBe(30);
    expect(stats.comments).toBe(15);
    // (30 + 15) / 400 — aggregated on sums, NOT a mean of per-post rates.
    expect(stats.engagement).toBeCloseTo(45 / 400, 10);
  });
  it("empty list → zeros and null engagement", () => {
    const stats = computeGlobalStats([]);
    expect(stats).toEqual({
      vues: 0,
      likes: 0,
      comments: 0,
      engagement: null,
      engagementVues: 0,
    });
  });
  it("aggregated engagement differs from a naive per-post mean", () => {
    // Post A: 100 vues, engagement 0.5 ; Post B: 1 vue, engagement 1.0.
    // Mean of rates = 0.75 ; aggregated = (51)/(101) ≈ 0.5049.
    const stats = computeGlobalStats([
      { vues: 100, likes: 50, comments: 0 },
      { vues: 1, likes: 1, comments: 0 },
    ]);
    expect(stats.engagement).toBeCloseTo(51 / 101, 10);
    expect(stats.engagement).not.toBeCloseTo(0.75, 3);
  });
});

describe("point 1 — le tri-état pilote la POPULATION, pas le DÉNOMINATEUR du taux", () => {
  // 1 post promo (engagement 10 %) + 1 post warmup (engagement 1 %). Le naïf
  // « tout confondu » donnerait 190/10000 = 1,9 % — le warmup au dénominateur
  // écrase le taux (le biais TD-019 exact). La règle : l'engagement l'exclut.
  const promo = { vues: 1000, likes: 100, comments: 0, isWarmup: false };
  const warm = { vues: 9000, likes: 90, comments: 0, isWarmup: true };

  it('mode "all" : sommes sur TOUT, engagement HORS warmup', () => {
    const s = computeGlobalStats([promo, warm], "all");
    expect(s.vues).toBe(10000); // la somme inclut le warmup
    expect(s.engagementVues).toBe(1000); // le dénominateur du taux l'exclut
    expect(s.engagement).toBeCloseTo(100 / 1000, 10); // 10 %, pas 1,9 %
  });

  it('mode "only" : engagement SUR le warmup (c\'est l\'objet mesuré)', () => {
    const s = computeGlobalStats([warm], "only");
    expect(s.engagementVues).toBe(9000);
    expect(s.engagement).toBeCloseTo(90 / 9000, 10); // 1 %
  });

  it("défaut = exclude : un post warmup ne pollue jamais le taux", () => {
    const s = computeGlobalStats([promo, warm]);
    expect(s.vues).toBe(10000);
    expect(s.engagementVues).toBe(1000);
    expect(s.engagement).toBeCloseTo(100 / 1000, 10);
  });

  it("aggregateByCategory applique la même règle par catégorie", () => {
    const rows = aggregateByCategory(
      [
        { key: "k", label: "K", vues: 1000, likes: 100, comments: 0, isWarmup: false },
        { key: "k", label: "K", vues: 9000, likes: 90, comments: 0, isWarmup: true },
      ],
      "all",
    );
    const k = rows.find((r) => r.key === "k")!;
    expect(k.vues).toBe(10000);
    expect(k.engagementVues).toBe(1000);
    expect(k.engagement).toBeCloseTo(100 / 1000, 10);
  });
});

describe("aggregateByCategory", () => {
  const items: CategoryItem[] = [
    { key: "tiktok", label: "TikTok", vues: 100, likes: 10, comments: 5 },
    { key: "youtube", label: "YouTube", vues: 50, likes: 2, comments: 1 },
    { key: "tiktok", label: "TikTok", vues: 300, likes: 20, comments: 10 },
  ];

  it("groups by key and sums metrics", () => {
    const rows = aggregateByCategory(items);
    const tiktok = rows.find((r) => r.key === "tiktok")!;
    expect(tiktok.vues).toBe(400);
    expect(tiktok.likes).toBe(30);
    expect(tiktok.comments).toBe(15);
    expect(tiktok.engagement).toBeCloseTo(45 / 400, 10);
  });

  it("sorts by vues descending", () => {
    const rows = aggregateByCategory(items);
    expect(rows.map((r) => r.key)).toEqual(["tiktok", "youtube"]);
  });

  it("empty input → empty output", () => {
    expect(aggregateByCategory([])).toEqual([]);
  });
});
