import { describe, expect, it } from "vitest";
import { leaderboardWindow, type RankedEntry } from "./leaderboard-window";

/** Classement à la forme de la prod : noms complets, montants au centime. */
function board(meRank: number | null, n = 6): RankedEntry[] {
  const dues = [318.4, 251.25, 165.9, 142.1, 128.35, 96.0, 40.5, 12.75];
  const names = [
    "Maëlys Robert",
    "Sofia Benali",
    "Chloé Dubois-Martin",
    "Kelly Moreau",
    "Inès Petrović",
    "Léa Garnier",
    "Nour El Amrani",
    "Camille Roux",
  ];
  return Array.from({ length: n }, (_, i) => ({
    creatorId: `k57${i}fq2wm0c8vj3tpd1rehxz6ynb45s9`,
    name: names[i],
    rank: i + 1,
    totalDue: dues[i],
    isMe: meRank === i + 1,
  }));
}

describe("leaderboardWindow", () => {
  it("au milieu : la voisine du dessus, toi, la voisine du dessous", () => {
    const w = leaderboardWindow(board(4))!;
    expect(w.rows.map((r) => r.rank)).toEqual([3, 4, 5]);
    expect(w.me.name).toBe("Kelly Moreau");
    expect(w.ahead?.name).toBe("Chloé Dubois-Martin");
    // 165.9 - 142.1 : l'arrondi au centime évite 23.799999999999983.
    expect(w.gapToAhead).toBe(23.8);
    expect(w.total).toBe(6);
  });

  it("première : pas de place au-dessus, la fenêtre glisse vers le bas", () => {
    const w = leaderboardWindow(board(1))!;
    expect(w.rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(w.ahead).toBeNull();
    expect(w.gapToAhead).toBeNull();
  });

  it("dernière : la fenêtre glisse vers le haut et garde sa taille", () => {
    const w = leaderboardWindow(board(6))!;
    expect(w.rows.map((r) => r.rank)).toEqual([4, 5, 6]);
    expect(w.gapToAhead).toBe(32.35);
  });

  it("moins de classées que la fenêtre : tout le monde", () => {
    const w = leaderboardWindow(board(2, 2))!;
    expect(w.rows.map((r) => r.rank)).toEqual([1, 2]);
  });

  it("égalité : l'écart vaut 0, jamais un négatif", () => {
    const entries = board(3);
    entries[2].totalDue = entries[1].totalDue;
    expect(leaderboardWindow(entries)!.gapToAhead).toBe(0);
  });

  it("pas classée : null, l'accueil n'invente pas de place", () => {
    expect(leaderboardWindow(board(null))).toBeNull();
    // Présence appariée : la même liste avec elle dedans rend une fenêtre.
    expect(leaderboardWindow(board(5))).not.toBeNull();
  });
});
