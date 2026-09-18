import { describe, expect, it } from "vitest";
import {
  buildManagerPayRows,
  cpmTrace,
  managerCpmProblem,
  managerPayAmount,
  managerPayByCreator,
  managerPayPeriodOf,
  managerPayPeriods,
  parseCpmTrace,
  sumManagerPayRows,
} from "../convex/managerCpm";

// Ids de la forme de ceux de la prod (Convex), jamais « a » / « b ».
const KELLY = "k57dq3hc9w1ry2v0e7t5n8m4xs6jbf1p";
const INES = "k57f0a2m8c3rq9w1y6t4v7n5bx2hsd8e";
const HORS = "k57zz9y8x7w6v5u4t3s2r1q0pon2mlk3";

// 14/09/2026 18:37 Paris et 31/08/2026 23:12 UTC : un jour ≠ aujourd'hui, et une
// vidéo publiée à la toute fin d'un mois.
const SEPT = Date.UTC(2026, 8, 14, 16, 37);
const FIN_AOUT = Date.UTC(2026, 7, 31, 23, 12);

describe("managerPayAmount", () => {
  it("0,20 pour 1 000 vues sur 48 317 vues", () => {
    expect(managerPayAmount(48_317, 0.2)).toBeCloseTo(9.6634, 6);
  });
  it("des vues négatives ne font jamais un montant négatif", () => {
    expect(managerPayAmount(-1_200, 0.35)).toBe(0);
  });
});

describe("managerCpmProblem", () => {
  it("accepte un CPM à décimales", () => {
    expect(managerCpmProblem(0.35)).toBeNull();
  });
  it("refuse zéro, le négatif, NaN et l'excès", () => {
    expect(managerCpmProblem(0)).toBe("not_positive");
    expect(managerCpmProblem(-0.2)).toBe("not_positive");
    expect(managerCpmProblem(Number.NaN)).toBe("not_a_number");
    expect(managerCpmProblem(200)).toBe("too_high");
  });
});

describe("managerPayPeriodOf", () => {
  it("prend le mois UTC de la publication", () => {
    expect(managerPayPeriodOf(SEPT)).toBe("2026-09");
    expect(managerPayPeriodOf(FIN_AOUT)).toBe("2026-08");
  });
});

describe("buildManagerPayRows", () => {
  const videos = [
    { creatorId: KELLY, publishedAt: SEPT, payableViews: 48_317, totalViews: 51_904 },
    { creatorId: KELLY, publishedAt: SEPT + 3_600_000, payableViews: 12_086, totalViews: 12_086 },
    { creatorId: KELLY, publishedAt: FIN_AOUT, payableViews: 7_431, totalViews: 9_002 },
    { creatorId: INES, publishedAt: SEPT, payableViews: 103_559, totalViews: 103_559 },
    // Une créatrice sans CPM : ne rapporte rien, même si elle fait des vues.
    { creatorId: HORS, publishedAt: SEPT, payableViews: 250_000, totalViews: 250_000 },
  ];
  const cpms = [
    { creatorId: KELLY, cpm: 0.2 },
    { creatorId: INES, cpm: 0.35 },
  ];
  const rows = buildManagerPayRows(videos, cpms);

  it("une ligne par (créatrice, mois), la créatrice sans CPM absente", () => {
    expect(rows.map((r) => `${r.creatorId}|${r.period}`).sort()).toEqual(
      [`${INES}|2026-09`, `${KELLY}|2026-08`, `${KELLY}|2026-09`].sort(),
    );
    expect(rows.some((r) => r.creatorId === HORS)).toBe(false);
  });

  it("chaque créatrice est payée à SON taux, sur les vues RÉMUNÉRÉES", () => {
    const kellySept = rows.find((r) => r.creatorId === KELLY && r.period === "2026-09")!;
    expect(kellySept.videos).toBe(2);
    expect(kellySept.payableViews).toBe(60_403);
    expect(kellySept.totalViews).toBe(63_990);
    expect(kellySept.amount).toBeCloseTo(12.0806, 6);
    const ines = rows.find((r) => r.creatorId === INES)!;
    expect(ines.amount).toBeCloseTo(36.24565, 6);
  });

  it("totaux par mois et depuis le début", () => {
    expect(sumManagerPayRows(rows, "2026-08").amount).toBeCloseTo(1.4862, 6);
    const all = sumManagerPayRows(rows);
    expect(all.videos).toBe(4);
    expect(all.payableViews).toBe(171_393);
    expect(all.amount).toBeCloseTo(12.0806 + 36.24565 + 1.4862, 6);
  });

  it("par créatrice, du plus gros montant au plus petit", () => {
    const by = managerPayByCreator(rows);
    expect(by.map((b) => b.creatorId)).toEqual([INES, KELLY]);
    expect(by[1].videos).toBe(3);
    expect(managerPayByCreator(rows, "2026-08").map((b) => b.creatorId)).toEqual([KELLY]);
  });

  it("mois du plus récent au plus ancien", () => {
    expect(managerPayPeriods(rows)).toEqual(["2026-09", "2026-08"]);
  });
});

describe("journal des CPM", () => {
  it("aller-retour d'une ligne", () => {
    const [line] = cpmTrace([{ creatorId: KELLY, cpm: 0.35 }]);
    expect(line).toBe(`cpm:${KELLY}:0.35`);
    expect(parseCpmTrace(line)).toEqual({ creatorId: KELLY, cpm: 0.35 });
  });
  it("une ligne de périmètre ou un bloc n'est pas un CPM", () => {
    expect(parseCpmTrace(`périmètre:${KELLY}`)).toBeNull();
    expect(parseCpmTrace("creators.read")).toBeNull();
  });
  it("absent = aucune ligne", () => {
    expect(cpmTrace(undefined)).toEqual([]);
  });
});
