import { describe, it, expect } from "vitest";
import { analyserExperience, pPermutation, varianteDe, type Bloc } from "../convex/experienceStats";

/**
 * Le verdict d'une expérience de hooks. Ce qui doit tenir : un gagnant n'est
 * déclaré que si le hasard l'explique mal (p < 0,05), sur assez de créatrices
 * COMPLÈTES ; une vidéo virale ne décide pas seule (logarithme) ; le même jeu de
 * données rend toujours le même p.
 */
const bloc = (cle: string, ...vues: (number | null)[]): Bloc => ({ cle, vues });

describe("test de permutation intra-créatrice", () => {
  it("deux variantes, 5 créatrices toutes en faveur de A : p exact = 2/32", () => {
    const blocs = [
      [Math.log1p(4200), Math.log1p(2100)],
      [Math.log1p(3900), Math.log1p(3100)],
      [Math.log1p(12800), Math.log1p(5400)],
      [Math.log1p(2600), Math.log1p(2550)],
      [Math.log1p(7300), Math.log1p(1900)],
    ];
    expect(pPermutation(blocs, 2)).toBeCloseTo(2 / 32, 10);
  });

  it("aucune différence : p = 1", () => {
    expect(pPermutation([[5, 5], [7, 7], [3, 3]], 2)).toBe(1);
  });

  it("trois variantes sur 8 créatrices : Monte-Carlo, même p à chaque lecture", () => {
    const blocs = Array.from({ length: 8 }, (_, i) => [Math.log1p(5000 + i * 300), Math.log1p(2500 + i * 200), Math.log1p(2400 + i * 250)]);
    const p1 = pPermutation(blocs, 3);
    expect(p1).toBe(pPermutation(blocs, 3));
    expect(p1).toBeLessThan(0.01);
  });
});

describe("verdict", () => {
  it("6 créatrices en faveur de A : gagnante, avec l'écart en moyenne géométrique", () => {
    const r = analyserExperience(
      [
        bloc("Kelly Martin", 4200, 2100),
        bloc("Léa Fontaine", 3900, 3100),
        bloc("Inès Garnier", 12800, 5400),
        bloc("Nora Lefebvre", 2600, 2550),
        bloc("Clara Vidal", 7300, 1900),
        bloc("Maëlle Dupuis", 5100, 4700),
      ],
      2,
    );
    expect(r.verdict).toBe("gagnante");
    expect(r.meilleure).toBe(0);
    expect(r.p).toBeCloseTo(2 / 64, 3);
    expect(r.blocsComplets).toBe(6);
    // Moyenne GÉOMÉTRIQUE des rapports A/B chez chaque créatrice (log1p), pas l'écart des moyennes brutes.
    expect(r.ecartPct).toBe(71.4);
    expect(r.variantes.map((v) => v.medianeVues)).toEqual([4650, 2825]);
  });

  it("une seule vidéo virale ne fait pas un gagnant", () => {
    const r = analyserExperience(
      [
        bloc("Kelly Martin", 412000, 3100),
        bloc("Léa Fontaine", 2900, 3300),
        bloc("Inès Garnier", 3100, 3600),
        bloc("Nora Lefebvre", 2700, 2650),
        bloc("Clara Vidal", 3300, 3500),
      ],
      2,
    );
    expect(r.verdict).toBe("pas_de_difference");
    expect(r.p!).toBeGreaterThan(SEUIL());
  });

  it("trop tôt sous 3 créatrices COMPLÈTES ; les mesures partielles restent comptées par variante", () => {
    const r = analyserExperience([bloc("Kelly Martin", 4200, 2100), bloc("Léa Fontaine", 3900, null), bloc("Inès Garnier", null, 5400)], 2);
    expect(r.verdict).toBe("trop_tot");
    expect(r.p).toBeNull();
    expect(r.blocsComplets).toBe(1);
    expect(r.variantes.map((v) => v.mesurees)).toEqual([2, 2]);
  });
});

describe("plan en carré latin", () => {
  it("chaque jour voit chaque variante une fois, chaque créatrice tourne toutes les variantes", () => {
    const k = 3;
    for (let j = 0; j < k; j++) expect(new Set([0, 1, 2].map((i) => varianteDe(i, j, k))).size).toBe(k);
    for (let i = 0; i < k; i++) expect(new Set([0, 1, 2].map((j) => varianteDe(i, j, k))).size).toBe(k);
    expect([0, 1, 2, 3].map((i) => varianteDe(i, 0, 3))).toEqual([0, 1, 2, 0]);
  });
});

function SEUIL() {
  return 0.05;
}
