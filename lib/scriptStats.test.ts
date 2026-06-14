import { describe, it, expect } from "vitest";
import {
  median,
  mean,
  quantile,
  statusForCount,
  summarize,
  JUGEABLE_THRESHOLD,
} from "./scriptStats";

describe("median", () => {
  it("jeu vide → null", () => {
    expect(median([])).toBeNull();
  });

  it("n impair → valeur centrale", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([10])).toBe(10);
    expect(median([5, 100, 1, 2, 3])).toBe(3); // tri → [1,2,3,5,100]
  });

  it("n pair → moyenne des deux centraux", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([4, 1, 3, 2])).toBe(2.5); // insensible à l'ordre d'entrée
    expect(median([10, 20])).toBe(15);
  });

  it("ne mute pas l'entrée", () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe("mean", () => {
  it("jeu vide → null", () => {
    expect(mean([])).toBeNull();
  });
  it("moyenne arithmétique", () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(mean([1, 2])).toBe(1.5);
  });
});

describe("quantile", () => {
  it("jeu vide → null", () => {
    expect(quantile([], 0.25)).toBeNull();
  });

  it("n=1 → la seule valeur quel que soit q", () => {
    expect(quantile([42], 0.25)).toBe(42);
    expect(quantile([42], 0.75)).toBe(42);
  });

  it("p25 / p75 par interpolation linéaire (méthode .INC)", () => {
    // [1,2,3,4,5] : pos p25 = (5-1)*0.25 = 1 → s[1] = 2 ; p75 = 4*0.75 = 3 → s[3] = 4
    const s = [5, 1, 4, 2, 3];
    expect(quantile(s, 0.25)).toBe(2);
    expect(quantile(s, 0.5)).toBe(3);
    expect(quantile(s, 0.75)).toBe(4);
  });

  it("interpole entre deux rangs quand la position est fractionnaire", () => {
    // [10,20,30,40] : p25 → pos = 3*0.25 = 0.75 → 10 + (20-10)*0.75 = 17.5
    expect(quantile([10, 20, 30, 40], 0.25)).toBe(17.5);
    // p75 → pos = 3*0.75 = 2.25 → 30 + (40-30)*0.25 = 32.5
    expect(quantile([10, 20, 30, 40], 0.75)).toBe(32.5);
  });
});

describe("statusForCount — seuil 50", () => {
  it("49 → en_test, 50 → jugeable (bascule exacte)", () => {
    expect(JUGEABLE_THRESHOLD).toBe(50);
    expect(statusForCount(0)).toBe("en_test");
    expect(statusForCount(49)).toBe("en_test");
    expect(statusForCount(50)).toBe("jugeable");
    expect(statusForCount(51)).toBe("jugeable");
  });
});

describe("summarize", () => {
  it("jeu vide → tout null, postCount 0, en_test", () => {
    expect(summarize([])).toEqual({
      postCount: 0,
      viewsMedian: null,
      viewsMean: null,
      viewsP25: null,
      viewsP75: null,
      status: "en_test",
    });
  });

  it("échantillon connu", () => {
    const d = summarize([10, 20, 30, 40, 50]);
    expect(d.postCount).toBe(5);
    expect(d.viewsMedian).toBe(30);
    expect(d.viewsMean).toBe(30);
    expect(d.viewsP25).toBe(20);
    expect(d.viewsP75).toBe(40);
    expect(d.status).toBe("en_test"); // < 50 posts
  });

  it("≥ 50 posts → jugeable", () => {
    const values = Array.from({ length: 50 }, (_, i) => i + 1);
    expect(summarize(values).status).toBe("jugeable");
    expect(summarize(values).postCount).toBe(50);
  });
});
