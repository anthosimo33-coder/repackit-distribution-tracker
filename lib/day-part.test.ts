import { describe, expect, it } from "vitest";
import { dayPartAt } from "./day-part";

describe("dayPartAt", () => {
  // 18/09/2026 07:40 UTC = 09:40 Paris = 03:40 New York = 00:40 Los Angeles.
  const t = Date.UTC(2026, 8, 18, 7, 40);

  it("se lit dans le fuseau de la créatrice, pas dans celui de l'équipe", () => {
    expect(dayPartAt(t, "Europe/Paris")).toBe("morning");
    expect(dayPartAt(t, "America/New_York")).toBe("evening");
    expect(dayPartAt(t, "America/Los_Angeles")).toBe("evening");
  });

  it("les bornes : 12 h est l'après-midi, 18 h le soir, 5 h le matin", () => {
    expect(dayPartAt(Date.UTC(2026, 8, 18, 10, 0), "Europe/Paris")).toBe("afternoon");
    expect(dayPartAt(Date.UTC(2026, 8, 18, 15, 59), "Europe/Paris")).toBe("afternoon");
    expect(dayPartAt(Date.UTC(2026, 8, 18, 16, 0), "Europe/Paris")).toBe("evening");
    expect(dayPartAt(Date.UTC(2026, 8, 18, 3, 0), "Europe/Paris")).toBe("morning");
  });

  it("fuseau inconnu ou illisible : Paris", () => {
    expect(dayPartAt(t, null)).toBe("morning");
    expect(dayPartAt(t, "Mars/Olympus_Mons")).toBe("morning");
  });
});
