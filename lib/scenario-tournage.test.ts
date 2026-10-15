import { describe, it, expect } from "vitest";
import { lireLienTournage, veille } from "../convex/scenarioTournageRegles";

describe("veille", () => {
  it("recule d'un jour, mois et années compris", () => {
    expect(veille("2026-10-15")).toBe("2026-10-14");
    expect(veille("2026-11-01")).toBe("2026-10-31");
    expect(veille("2026-01-01")).toBe("2025-12-31");
    expect(veille("2028-03-01")).toBe("2028-02-29");
  });

  it("ignore les changements d'heure (jours de Paris, pas des heures)", () => {
    expect(veille("2026-10-26")).toBe("2026-10-25");
    expect(veille("2026-03-30")).toBe("2026-03-29");
  });
});

describe("lireLienTournage", () => {
  it("garde un lien https collé, sans les blancs du bord", () => {
    expect(lireLienTournage("  https://askblush.com/tournage/k3J9x  ")).toEqual({
      ok: true,
      lien: "https://askblush.com/tournage/k3J9x",
    });
  });

  it("vide = retirer le lien", () => {
    expect(lireLienTournage("   ")).toEqual({ ok: true, lien: null });
  });

  it("refuse ce qui n'est pas un lien https d'une ligne", () => {
    for (const x of [
      "askblush.com/tournage/k3J9x",
      "http://askblush.com/tournage/k3J9x",
      "javascript:alert(1)",
      "https://askblush.com/a b",
      "https://askblush.com/a\nhttps://askblush.com/b",
      `https://askblush.com/${"x".repeat(600)}`,
    ]) {
      expect(lireLienTournage(x), x).toEqual({ ok: false });
    }
  });
});
