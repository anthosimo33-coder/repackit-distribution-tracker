import { describe, it, expect } from "vitest";
import type { Doc } from "@/convex/_generated/dataModel";
import type { DisplayMetrics } from "@/convex/metricsDisplay";
import {
  getGlobalStats,
  getGlobalStatsShorts,
  aggregateByMecanique,
} from "./dashboard-stats";

// TD-019 — ces agrégats de perf doivent EXCLURE le warmup des sommes, ratios et
// classements, tout en gardant les COUNTS sur tous les posts publiés.

type Pub = Doc<"publications"> & { displayMetrics?: DisplayMetrics };

function pub(o: {
  isWarmup?: boolean;
  vues: number;
  saves?: number;
  subsGained?: number;
  mecanique?: string;
}): Pub {
  return {
    isWarmup: o.isWarmup,
    mecanique: o.mecanique ?? "Erreur",
    postUrl: "https://x", // isPublished() amont ; ces fonctions n'en dépendent pas
    displayMetrics: {
      vues: o.vues,
      saves: o.saves ?? null,
      likes: null,
      subsGained: o.subsGained ?? null,
      comments: null,
    },
  } as unknown as Pub;
}

describe("getGlobalStats — warmup exclu (TD-019)", () => {
  const posts = [
    pub({ vues: 1000, saves: 10 }), // monétisé, save rate 1 %
    pub({ vues: 1000, saves: 40, mecanique: "Volume" }), // monétisé, 4 % = WINNER
    pub({ isWarmup: true, vues: 100_000, saves: 5000 }), // chauffe, 5 % (fake winner)
  ];

  it("les vues warmup ne gonflent PAS totalVues", () => {
    expect(getGlobalStats(posts).totalVues).toBe(2000);
  });
  it("le save rate warmup ne compte pas comme WINNER", () => {
    expect(getGlobalStats(posts).winners).toBe(1);
  });
  it("le save rate moyen exclut le warmup", () => {
    // moyenne de 1 % et 4 % = 2,5 % ; le 5 % warmup est écarté
    expect(getGlobalStats(posts).avgSaveRate).toBeCloseTo(0.025, 6);
  });
  it("le COUNT reste sur tous les publiés (warmup inclus)", () => {
    expect(getGlobalStats(posts).total).toBe(3);
  });
});

describe("aggregateByMecanique — warmup exclu du groupe", () => {
  it("un post de chauffe ne gonfle pas les vues de sa mécanique", () => {
    const rows = aggregateByMecanique([
      pub({ vues: 1000, mecanique: "Erreur" }),
      pub({ isWarmup: true, vues: 100_000, mecanique: "Erreur" }),
    ]);
    const erreur = rows.find((r) => r.key === "Erreur");
    expect(erreur?.totalVues).toBe(1000);
    expect(erreur?.count).toBe(1); // le warmup ne compte pas dans ce groupe de perf
  });
});

describe("getGlobalStatsShorts — ratio subs/vues exclut le warmup (num. ET dénom.)", () => {
  it("le warmup ne dilue pas ratioSubsViews", () => {
    const stats = getGlobalStatsShorts([
      pub({ vues: 1000, subsGained: 10 }), // 1 %
      pub({ isWarmup: true, vues: 100_000, subsGained: 5 }), // diluerait à ~0,015 %
    ]);
    expect(stats.totalVuesJ7).toBe(1000);
    expect(stats.totalSubsGained).toBe(10);
    expect(stats.ratioSubsViews).toBeCloseTo(0.01, 6);
    expect(stats.total).toBe(2); // count = tous
  });
});
