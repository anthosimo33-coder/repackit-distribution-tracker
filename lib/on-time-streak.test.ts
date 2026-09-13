import { describe, expect, it } from "vitest";
import { onTimeStreak, type StreakRow } from "./on-time-streak";

/**
 * Jours prévus posés à minuit Paris (22:00 UTC la veille en été), publications
 * à des heures réelles de fin de journée, et une horloge au milieu d'après-midi.
 */
const NOW = Date.UTC(2026, 8, 18, 13, 12); // 18/09 15:12 Paris
const plan = (d: number) => Date.UTC(2026, 8, d - 1, 22, 0);
const at = (d: number, h: number, m = 0) => Date.UTC(2026, 8, d, h - 2, m); // heure Paris

function post(d: number, publishedAt: number | null, over: Partial<StreakRow> = {}): StreakRow {
  return {
    status: publishedAt === null ? "to_publish" : "published",
    postDate: plan(d),
    creatorTimezone: "Europe/Paris",
    targets: [{ publishedAt }],
    ...over,
  };
}

describe("onTimeStreak", () => {
  it("compte les publications à l'heure qui se suivent jusqu'au dernier post passé", () => {
    const rows = [
      post(10, at(10, 19, 42)),
      post(12, at(13, 9, 5)), // publié le lendemain : en retard, la série repart
      post(14, at(14, 18, 20)),
      post(15, at(15, 21, 55)),
      post(17, at(17, 20, 3)),
    ];
    expect(onTimeStreak(rows, NOW)).toEqual({ current: 3, best: 3 });
  });

  it("un manqué casse la série, un post à venir ne l'interrompt pas", () => {
    const rows = [
      post(8, at(8, 12)),
      post(9, at(9, 17)),
      post(11, at(11, 20)),
      post(13, null), // jour passé sans publication : manqué
      post(16, at(16, 19)),
      post(20, null), // à venir
    ];
    expect(onTimeStreak(rows, NOW)).toEqual({ current: 1, best: 3 });
  });

  it("le post du jour pas encore publié ne casse rien (elle a la soirée)", () => {
    const rows = [post(16, at(16, 19)), post(17, at(17, 22)), post(18, null)];
    expect(onTimeStreak(rows, NOW).current).toBe(2);
  });

  it("comptes gérés et missions annulées sont hors série", () => {
    const rows = [
      post(14, at(14, 19)),
      post(15, null, { managedByAdmin: true }), // manqué, mais géré par l'équipe
      post(16, null, { status: "cancelled" }),
      post(17, at(17, 18)),
    ];
    expect(onTimeStreak(rows, NOW)).toEqual({ current: 2, best: 2 });
    // Présence appariée : la même ligne NON gérée est un manqué qui casse.
    const cassee = [post(14, at(14, 19)), post(15, null), post(17, at(17, 18))];
    expect(onTimeStreak(cassee, NOW).current).toBe(1);
  });

  it("aucun post passé : zéro partout", () => {
    expect(onTimeStreak([post(21, null)], NOW)).toEqual({ current: 0, best: 0 });
    expect(onTimeStreak([], NOW)).toEqual({ current: 0, best: 0 });
  });
});
