import { describe, it, expect } from "vitest";
import {
  engagementRate,
  computeGlobalStats,
  aggregateByCategory,
  computeDailyViewDeltas,
  dayKeyUTC,
  matchesDimensionFilters,
  type CategoryItem,
  type SnapshotPoint,
  type PostDimensions,
} from "./tracker-data";

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
    expect(stats).toEqual({ vues: 0, likes: 0, comments: 0, engagement: null });
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

describe("dayKeyUTC", () => {
  it("formats a UTC calendar day", () => {
    expect(dayKeyUTC(Date.UTC(2026, 2, 5, 13, 0, 0))).toBe("2026-03-05");
    expect(dayKeyUTC(Date.UTC(2026, 11, 1, 0, 0, 0))).toBe("2026-12-01");
  });
});

describe("computeDailyViewDeltas", () => {
  const D = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 12, 0, 0);

  it("single publication: per-day gained = consecutive deltas, first snapshot is baseline", () => {
    const snaps: SnapshotPoint[] = [
      { publicationId: "p1", capturedAt: D(2026, 3, 1), vues: 100 }, // baseline
      { publicationId: "p1", capturedAt: D(2026, 3, 2), vues: 180 }, // +80
      { publicationId: "p1", capturedAt: D(2026, 3, 3), vues: 200 }, // +20
    ];
    expect(computeDailyViewDeltas(snaps)).toEqual([
      { date: "2026-03-02", value: 80 },
      { date: "2026-03-03", value: 20 },
    ]);
  });

  it("sums deltas across multiple publications per day", () => {
    const snaps: SnapshotPoint[] = [
      { publicationId: "p1", capturedAt: D(2026, 3, 1), vues: 0 },
      { publicationId: "p1", capturedAt: D(2026, 3, 2), vues: 100 }, // +100
      { publicationId: "p2", capturedAt: D(2026, 3, 1), vues: 10 },
      { publicationId: "p2", capturedAt: D(2026, 3, 2), vues: 60 }, // +50
    ];
    expect(computeDailyViewDeltas(snaps)).toEqual([
      { date: "2026-03-02", value: 150 },
    ]);
  });

  it("is NOT cumulative (curve can go down)", () => {
    const snaps: SnapshotPoint[] = [
      { publicationId: "p1", capturedAt: D(2026, 3, 1), vues: 0 },
      { publicationId: "p1", capturedAt: D(2026, 3, 2), vues: 1000 }, // +1000
      { publicationId: "p1", capturedAt: D(2026, 3, 3), vues: 1050 }, // +50
    ];
    const out = computeDailyViewDeltas(snaps);
    expect(out[0].value).toBe(1000);
    expect(out[1].value).toBe(50);
    expect(out[1].value).toBeLessThan(out[0].value);
  });

  it("clamps negative deltas (platform recount) to 0", () => {
    const snaps: SnapshotPoint[] = [
      { publicationId: "p1", capturedAt: D(2026, 3, 1), vues: 500 },
      { publicationId: "p1", capturedAt: D(2026, 3, 2), vues: 480 }, // -20 → 0 (skipped)
      { publicationId: "p1", capturedAt: D(2026, 3, 3), vues: 530 }, // +50
    ];
    expect(computeDailyViewDeltas(snaps)).toEqual([
      { date: "2026-03-03", value: 50 },
    ]);
  });

  it("multiple snapshots same day sum to the day's net gain", () => {
    const snaps: SnapshotPoint[] = [
      { publicationId: "p1", capturedAt: Date.UTC(2026, 2, 2, 8), vues: 0 }, // baseline
      { publicationId: "p1", capturedAt: Date.UTC(2026, 2, 2, 12), vues: 30 }, // +30
      { publicationId: "p1", capturedAt: Date.UTC(2026, 2, 2, 20), vues: 50 }, // +20
    ];
    expect(computeDailyViewDeltas(snaps)).toEqual([
      { date: "2026-03-02", value: 50 },
    ]);
  });

  it("handles unsorted input and gaps (gain attributed to the observed day)", () => {
    const snaps: SnapshotPoint[] = [
      { publicationId: "p1", capturedAt: D(2026, 3, 5), vues: 200 }, // +120 on day 5
      { publicationId: "p1", capturedAt: D(2026, 3, 1), vues: 80 }, // baseline
    ];
    expect(computeDailyViewDeltas(snaps)).toEqual([
      { date: "2026-03-05", value: 120 },
    ]);
  });

  it("empty input → empty series", () => {
    expect(computeDailyViewDeltas([])).toEqual([]);
  });
});
