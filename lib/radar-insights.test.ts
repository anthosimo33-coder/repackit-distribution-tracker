import { describe, expect, it } from "vitest";
import {
  INSIGHT_MAX_AGE_MS,
  INSIGHT_MIN_AGE_MS,
  headline,
  isOriginalSound,
  judged,
  pctOf,
  standout,
  wordCount,
  type InsightVideo,
} from "../convex/radarInsightsMath";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 9, 12);

/** `n` vidéos publiées il y a 3 jours, dont `wins` à 5× la médiane (1 000). */
function videos(n: number, wins: number, over: Partial<InsightVideo> = {}): InsightVideo[] {
  return Array.from({ length: n }, (_, i) => ({
    appId: "app1",
    appName: "FollowSpy",
    lang: "en",
    publishedAt: NOW - 3 * DAY,
    views: i < wins ? 5_000 : 500,
    median: 1_000,
    ...over,
  }));
}

describe("ce qui sort du lot (radarInsightsMath)", () => {
  it("ne juge que les vidéos de 2 à 14 jours d'un compte dont la médiane est connue", () => {
    const base = videos(1, 1)[0];
    const vs = judged(
      [
        { ...base, publishedAt: NOW - INSIGHT_MIN_AGE_MS + 1 }, // trop jeune
        { ...base, publishedAt: NOW - INSIGHT_MAX_AGE_MS - 1 }, // trop vieille
        { ...base, median: undefined },
        { ...base, median: 0 },
        base,
      ],
      NOW,
    );
    expect(vs).toHaveLength(1);
    expect(vs[0].win).toBe(true);
  });

  it("sortir du lot = 3× la normale du compte, pas moins", () => {
    const [a, b] = judged([...videos(1, 0, { views: 3_000 }), ...videos(1, 0, { views: 2_999 })], NOW);
    expect([a.win, b.win]).toEqual([true, false]);
  });

  it("par langue et par app : 20 vidéos au moins, la plus forte part en tête", () => {
    const r = standout(
      [
        ...videos(40, 20, { lang: "es-am" }),
        ...videos(60, 3, { lang: "pt", appId: "app2", appName: "Stalkie" }),
        ...videos(19, 19, { lang: "fr", appId: "app3", appName: "Katch" }), // 19 vidéos : pas affichée
      ],
      NOW,
    );
    expect(r.n).toBe(119);
    expect(r.byLang.map((b) => [b.key, b.n, b.wins])).toEqual([
      ["es-am", 40, 20],
      ["pt", 60, 3],
    ]);
    expect(r.byApp.map((b) => [b.label, Math.round(pctOf(b))])).toEqual([
      ["FollowSpy", 50],
      ["Stalkie", 5],
    ]);
  });

  it("une façon de faire : « pas d'écart » sous 3 points, « pas assez » sous 30 vidéos d'un côté", () => {
    // 09/11 (export prod) : texte à l'écran 11 % avec, 11 % sans.
    const r = standout([...videos(100, 11, { hook: "Il like encore ses photos" }), ...videos(100, 12)], NOW);
    const texte = r.attrs.find((a) => a.key === "texte")!;
    expect([texte.verdict, texte.better]).toEqual(["pasEcart", null]);
    // Aucun hook long : « pas assez de vidéos », même avec un écart.
    const longueur = r.attrs.find((a) => a.key === "longueur")!;
    expect([longueur.a.n, longueur.b.n, longueur.verdict]).toEqual([0, 100, "pasAssez"]);
  });

  it("musique contre son original : l'écart compte à 3 points et dit qui gagne", () => {
    const r = standout(
      [...videos(50, 7, { musicTitle: "Espresso - Sabrina Carpenter" }), ...videos(50, 5, { musicTitle: "original sound - meline.stalk" }), ...videos(10, 10)],
      NOW,
    );
    const son = r.attrs.find((a) => a.key === "son")!;
    // 14 % contre 10 % : +4 pts pour la musique ; les vidéos sans son ne comptent pas.
    expect([son.a.n, son.b.n, son.verdict, son.better, son.gapPts]).toEqual([50, 50, "ecart", "a", 4]);
  });

  it("hook court = 8 mots ou moins", () => {
    expect(wordCount("  POV : tu fouilles son   téléphone ")).toBe(6);
    const r = standout(
      [
        ...videos(40, 2, { hook: "un deux trois quatre cinq six sept huit" }),
        ...videos(40, 10, { hook: "un deux trois quatre cinq six sept huit neuf" }),
      ],
      NOW,
    );
    const longueur = r.attrs.find((a) => a.key === "longueur")!;
    expect([longueur.a.n, longueur.b.n, longueur.better, longueur.gapPts]).toEqual([40, 40, "a", 20]);
  });

  it("reconnaît un son original dans plusieurs langues", () => {
    expect(["original sound - x", "son original - x", "sonido original - y", "Originalton - z"].every(isOriginalSound)).toBe(true);
    expect(isOriginalSound("Original Love - Song")).toBe(false);
  });

  it("phrase de tête : langues d'au moins 50 vidéos, hors « autre », ratio arrondi dès le double", () => {
    const b = (key: string, n: number, wins: number) => ({ key, n, wins });
    // 09/11 Snytch : l'espagnol d'Espagne (30 vidéos) n'entre pas dans la phrase.
    expect(headline([b("es-es", 30, 5), b("es-am", 352, 53), b("autre", 104, 13), b("en", 561, 61), b("pt", 54, 1)])).toEqual({
      best: b("es-am", 352, 53),
      worst: b("pt", 54, 1),
      ratio: 8,
    });
    // Moins du double : les deux parts, pas de ratio.
    expect(headline([b("en", 670, 83), b("es-am", 100, 7)])?.ratio).toBeNull();
    // La plus faible ne réussit jamais : pas de ratio (division par zéro).
    expect(headline([b("en", 100, 10), b("pt", 60, 0)])?.ratio).toBeNull();
    // Sous 3 points d'écart, ou une seule langue : pas de phrase.
    expect(headline([b("en", 100, 10), b("fr", 100, 8)])).toBeNull();
    expect(headline([b("en", 100, 10)])).toBeNull();
  });
});
