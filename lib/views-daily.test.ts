/**
 * Tests du module PUR convex/viewsDaily.ts (importé depuis lib/ comme le fait
 * déjà lib/date-fr.test.ts pour convex/dateFr).
 *
 * Les instants d'entrée sont posés à l'heure RÉELLE des relevés de prod —
 * 08:00 UTC, l'heure du cron `daily-tiktok-insta-views` (convex/crons.ts) — et
 * non à midi rond : c'est précisément le décalage 08:00 UTC ↔ 10:00 Paris qui
 * produisait le biais d'un jour, un midi rond l'aurait masqué.
 */
import { describe, it, expect } from "vitest";
import {
  computeDailyViewDeltas,
  parisDayKey,
  parisMidnightUtc,
  ESTIMATED_SPAN_MS,
  type SnapshotPoint,
} from "../convex/viewsDaily";

/** Instant UTC lisible : utc(2026, 8, 15, 8) = 15 août 2026 08:00 UTC. */
const utc = (y: number, m: number, d: number, h: number, min = 0): number =>
  Date.UTC(y, m - 1, d, h, min);

const HOUR = 3_600_000;

/** Série → { "YYYY-MM-DD": vues } pour des attentes lisibles. */
const valuesOf = (
  series: ReturnType<typeof computeDailyViewDeltas>,
): Record<string, number> =>
  Object.fromEntries(series.map((p) => [p.date, p.value]));

const estimatedOf = (
  series: ReturnType<typeof computeDailyViewDeltas>,
): Record<string, boolean> =>
  Object.fromEntries(series.map((p) => [p.date, p.estimated]));

const sumOf = (series: ReturnType<typeof computeDailyViewDeltas>): number =>
  series.reduce((acc, p) => acc + p.value, 0);

describe("parisDayKey — ancre LOCALE, pas UTC", () => {
  it("un relevé de fin de soirée UTC appartient au jour Paris SUIVANT (été)", () => {
    // 22:15 UTC = 00:15 Paris le lendemain (CEST, UTC+2).
    const ts = utc(2026, 8, 16, 22, 15);
    expect(parisDayKey(ts)).toBe("2026-08-17");
    // Contrôle : le jour UTC, lui, est bien le 16 — c'est l'écart qu'on corrige.
    expect(new Date(ts).toISOString().slice(0, 10)).toBe("2026-08-16");
  });

  it("idem en hiver, où le décalage n'est plus que d'une heure (CET)", () => {
    // 23:30 UTC = 00:30 Paris le lendemain.
    expect(parisDayKey(utc(2026, 12, 10, 23, 30))).toBe("2026-12-11");
    // 22:30 UTC est ENCORE le 10 en Paris l'hiver (alors qu'en été ce serait le 11).
    expect(parisDayKey(utc(2026, 12, 10, 22, 30))).toBe("2026-12-10");
  });

  it("en pleine journée, jour Paris et jour UTC coïncident", () => {
    expect(parisDayKey(utc(2026, 8, 17, 8, 0))).toBe("2026-08-17");
  });
});

describe("parisMidnightUtc — bornes de découpe, DST comprise", () => {
  it("minuit d'un jour d'été = 22:00 UTC la veille", () => {
    expect(parisMidnightUtc(2026, 8, 17)).toBe(utc(2026, 8, 16, 22, 0));
  });

  it("minuit d'un jour d'hiver = 23:00 UTC la veille", () => {
    expect(parisMidnightUtc(2026, 12, 11)).toBe(utc(2026, 12, 10, 23, 0));
  });

  it("le jour du passage à l'heure d'été ne dure que 23 h", () => {
    const start = parisMidnightUtc(2026, 3, 29);
    const end = parisMidnightUtc(2026, 3, 30);
    expect((end - start) / HOUR).toBe(23);
  });

  it("le jour du passage à l'heure d'hiver dure 25 h", () => {
    const start = parisMidnightUtc(2026, 10, 25);
    const end = parisMidnightUtc(2026, 10, 26);
    expect((end - start) / HOUR).toBe(25);
  });

  it("gère le débordement de mois (jour + 1 au-delà du dernier du mois)", () => {
    expect(parisMidnightUtc(2026, 8, 32)).toBe(parisMidnightUtc(2026, 9, 1));
  });
});

describe("computeDailyViewDeltas — répartition au prorata", () => {
  it("le rythme nominal (un relevé/jour à 08:00 UTC) n'écrase plus le gain sur J+1", () => {
    // 08:00 UTC = 10:00 Paris : l'intervalle couvre 14 h du 16 et 10 h du 17.
    const snaps: SnapshotPoint[] = [
      { publicationId: "p1", capturedAt: utc(2026, 8, 16, 8), vues: 18_400 },
      { publicationId: "p1", capturedAt: utc(2026, 8, 17, 8), vues: 20_800 },
    ];
    const out = computeDailyViewDeltas(snaps);

    expect(valuesOf(out)).toEqual({
      "2026-08-16": 1400, // 2400 × 14/24
      "2026-08-17": 1000, // 2400 × 10/24
    });
    // Le défaut d'origine : les 2400 vues entières datées du 17.
    expect(out.find((p) => p.date === "2026-08-17")?.value).not.toBe(2400);
  });

  it("un trou de sync de 48 h se répartit sur les 3 jours couverts, au prorata", () => {
    // Relevé du 15 manquant puis rattrapé le 17 : 14 h le 15, 24 h le 16, 10 h le 17.
    const snaps: SnapshotPoint[] = [
      { publicationId: "p1", capturedAt: utc(2026, 8, 15, 8), vues: 6200 },
      { publicationId: "p1", capturedAt: utc(2026, 8, 17, 8), vues: 11_000 },
    ];
    const out = computeDailyViewDeltas(snaps);

    expect(valuesOf(out)).toEqual({
      "2026-08-15": 1400, // 4800 × 14/48
      "2026-08-16": 2400, // 4800 × 24/48
      "2026-08-17": 1000, // 4800 × 10/48
    });
    expect(sumOf(out)).toBe(4800);
  });

  it("un intervalle COURT reste entier sur son jour (rien à répartir)", () => {
    // Relevé auto de 08:00 UTC puis relance manuelle à 14:00 UTC : les deux
    // instants tombent le 17 à Paris (10:00 puis 16:00).
    const snaps: SnapshotPoint[] = [
      { publicationId: "p1", capturedAt: utc(2026, 8, 17, 8), vues: 20_800 },
      { publicationId: "p1", capturedAt: utc(2026, 8, 17, 14), vues: 21_530 },
    ];
    expect(computeDailyViewDeltas(snaps)).toEqual([
      { date: "2026-08-17", value: 730, estimated: false },
    ]);
  });

  it("un intervalle nocturne est daté du jour PARIS, pas du jour UTC", () => {
    // 22:15 → 23:45 UTC le 16 = 00:15 → 01:45 Paris le 17. L'ancienne
    // attribution (jour UTC du point d'arrivée) l'aurait daté du 16.
    const snaps: SnapshotPoint[] = [
      { publicationId: "p1", capturedAt: utc(2026, 8, 16, 22, 15), vues: 12_480 },
      { publicationId: "p1", capturedAt: utc(2026, 8, 16, 23, 45), vues: 12_900 },
    ];
    expect(computeDailyViewDeltas(snaps)).toEqual([
      { date: "2026-08-17", value: 420, estimated: false },
    ]);
  });

  it("découpe correctement la journée de 23 h (passage à l'heure d'été)", () => {
    // 28/03 09:00 → 30/03 10:00 Paris : 15 h + 23 h + 10 h = 48 h.
    const snaps: SnapshotPoint[] = [
      { publicationId: "p1", capturedAt: utc(2026, 3, 28, 8), vues: 3100 },
      { publicationId: "p1", capturedAt: utc(2026, 3, 30, 8), vues: 7900 },
    ];
    const out = computeDailyViewDeltas(snaps);

    expect(valuesOf(out)).toEqual({
      "2026-03-28": 1500, // 4800 × 15/48
      "2026-03-29": 2300, // 4800 × 23/48 — le jour court reçoit MOINS
      "2026-03-30": 1000, // 4800 × 10/48
    });
    expect(sumOf(out)).toBe(4800);
  });

  it("découpe correctement la journée de 25 h (passage à l'heure d'hiver)", () => {
    // 24/10 10:00 CEST → 26/10 09:00 CET : 14 h + 25 h + 9 h = 48 h.
    const snaps: SnapshotPoint[] = [
      { publicationId: "p1", capturedAt: utc(2026, 10, 24, 8), vues: 3100 },
      { publicationId: "p1", capturedAt: utc(2026, 10, 26, 8), vues: 7900 },
    ];
    const out = computeDailyViewDeltas(snaps);

    expect(valuesOf(out)).toEqual({
      "2026-10-24": 1400, // 4800 × 14/48
      "2026-10-25": 2500, // 4800 × 25/48 — le jour long reçoit PLUS
      "2026-10-26": 900, // 4800 × 9/48
    });
    expect(sumOf(out)).toBe(4800);
  });

  it("conserve EXACTEMENT le total quand le prorata ne tombe pas juste", () => {
    const snaps: SnapshotPoint[] = [
      { publicationId: "p1", capturedAt: utc(2026, 8, 15, 8), vues: 41_206 },
      { publicationId: "p1", capturedAt: utc(2026, 8, 17, 8), vues: 53_555 },
    ];
    const out = computeDailyViewDeltas(snaps);

    // 12 349 × {14, 24, 10}/48 = 3601,79 / 6174,5 / 2572,71. Arrondir chaque
    // jour indépendamment donnerait 3602 + 6175 + 2573 = 12 350, soit une vue
    // INVENTÉE ; le plus fort reste sert le +1 aux deux plus gros restes.
    expect(valuesOf(out)).toEqual({
      "2026-08-15": 3602,
      "2026-08-16": 6174,
      "2026-08-17": 2573,
    });
    expect(sumOf(out)).toBe(12_349);
  });

  it("somme les contributions de plusieurs publications sur un même jour", () => {
    const snaps: SnapshotPoint[] = [
      { publicationId: "p1", capturedAt: utc(2026, 8, 16, 8), vues: 18_400 },
      { publicationId: "p1", capturedAt: utc(2026, 8, 17, 8), vues: 20_800 },
      { publicationId: "p2", capturedAt: utc(2026, 8, 16, 8), vues: 940 },
      { publicationId: "p2", capturedAt: utc(2026, 8, 17, 8), vues: 1420 },
    ];
    expect(valuesOf(computeDailyViewDeltas(snaps))).toEqual({
      "2026-08-16": 1680, // (2400 + 480) × 14/24
      "2026-08-17": 1200, // (2400 + 480) × 10/24
    });
  });
});

describe("computeDailyViewDeltas — drapeau « estimé »", () => {
  it("ne lève PAS le drapeau à 30 h pile, le lève au-delà", () => {
    const base: SnapshotPoint = {
      publicationId: "p1",
      capturedAt: utc(2026, 8, 16, 8),
      vues: 18_400,
    };
    const pile = computeDailyViewDeltas([
      base,
      {
        publicationId: "p1",
        capturedAt: base.capturedAt + ESTIMATED_SPAN_MS,
        vues: 21_400,
      },
    ]);
    expect(pile.every((p) => p.estimated)).toBe(false);
    expect(pile.some((p) => p.estimated)).toBe(false);

    const juste = computeDailyViewDeltas([
      base,
      {
        publicationId: "p1",
        capturedAt: base.capturedAt + ESTIMATED_SPAN_MS + 60_000,
        vues: 21_400,
      },
    ]);
    expect(juste.every((p) => p.estimated)).toBe(true);
    expect(juste.length).toBeGreaterThan(0);
  });

  it("un jour servi par un intervalle long ET un intervalle court est estimé", () => {
    const snaps: SnapshotPoint[] = [
      // p1 : sync manquée, 48 h entre deux relevés (15 → 17).
      { publicationId: "p1", capturedAt: utc(2026, 8, 15, 8), vues: 6200 },
      { publicationId: "p1", capturedAt: utc(2026, 8, 17, 8), vues: 11_000 },
      // p2 : relevé tous les jours (16 → 17 → 18).
      { publicationId: "p2", capturedAt: utc(2026, 8, 16, 8), vues: 940 },
      { publicationId: "p2", capturedAt: utc(2026, 8, 17, 8), vues: 1420 },
      { publicationId: "p2", capturedAt: utc(2026, 8, 18, 8), vues: 1700 },
    ];
    expect(estimatedOf(computeDailyViewDeltas(snaps))).toEqual({
      "2026-08-15": true, // p1 seul, intervalle de 48 h
      "2026-08-16": true, // p1 (48 h) + p2 (24 h) → au moins une part estimée
      "2026-08-17": true, // idem
      "2026-08-18": false, // p2 seul, intervalle de 24 h → mesuré
    });
  });
});

describe("computeDailyViewDeltas — invariants conservés", () => {
  it("le 1er snapshot de la fenêtre est une RÉFÉRENCE (aucun delta émis)", () => {
    const out = computeDailyViewDeltas([
      { publicationId: "p1", capturedAt: utc(2026, 8, 16, 8), vues: 18_400 },
    ]);
    expect(out).toEqual([]);
  });

  it("ramène un delta négatif (recomptage plateforme) à zéro", () => {
    const snaps: SnapshotPoint[] = [
      { publicationId: "p1", capturedAt: utc(2026, 8, 15, 8), vues: 52_300 },
      { publicationId: "p1", capturedAt: utc(2026, 8, 16, 8), vues: 51_900 }, // −400 → 0
      { publicationId: "p1", capturedAt: utc(2026, 8, 17, 8), vues: 52_140 }, // +240
    ];
    const out = computeDailyViewDeltas(snaps);
    expect(valuesOf(out)).toEqual({
      "2026-08-16": 140, // 240 × 14/24
      "2026-08-17": 100, // 240 × 10/24
    });
    // Le jour du recomptage ne reçoit RIEN de ce couple ; la présence du 16
    // vient bien du couple suivant, pas d'un delta négatif recyclé.
    expect(sumOf(out)).toBe(240);
  });

  it("n'est PAS cumulative (la courbe peut redescendre)", () => {
    const snaps: SnapshotPoint[] = [
      { publicationId: "p1", capturedAt: utc(2026, 8, 15, 8), vues: 0 },
      { publicationId: "p1", capturedAt: utc(2026, 8, 16, 8), vues: 48_000 },
      { publicationId: "p1", capturedAt: utc(2026, 8, 17, 8), vues: 50_400 },
    ];
    const v = valuesOf(computeDailyViewDeltas(snaps));
    expect(v["2026-08-16"]).toBeLessThan(v["2026-08-15"]);
    expect(v["2026-08-17"]).toBeLessThan(v["2026-08-16"]);
  });

  it("accepte une entrée non triée", () => {
    const trie: SnapshotPoint[] = [
      { publicationId: "p1", capturedAt: utc(2026, 8, 15, 8), vues: 6200 },
      { publicationId: "p1", capturedAt: utc(2026, 8, 17, 8), vues: 11_000 },
    ];
    expect(computeDailyViewDeltas([trie[1], trie[0]])).toEqual(
      computeDailyViewDeltas(trie),
    );
  });

  it("entrée vide → série vide", () => {
    expect(computeDailyViewDeltas([])).toEqual([]);
  });
});
