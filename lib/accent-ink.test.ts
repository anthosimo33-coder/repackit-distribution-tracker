import { describe, expect, it } from "vitest";
import { inkOn, relativeLuminance } from "./accent-ink";

/** Les couleurs des projets en prod le 09/11/2026 (table projects). */
describe("l'encre sur la couleur du projet", () => {
  it("blanc sur le violet de Snytch, noir sur le rose de BLUSH et sur l'orange par défaut", () => {
    expect(inkOn("#ab0fff")).toBe("light");
    expect(inkOn("#ff00d0")).toBe("dark");
    expect(inkOn("#FF5200")).toBe("dark");
    expect(inkOn("#ffceb8")).toBe("dark");
    expect(inkOn("#0f172a")).toBe("light");
  });

  it("une couleur illisible retombe sur l'encre sombre", () => {
    expect(relativeLuminance("rose")).toBeNull();
    expect(inkOn("rose")).toBe("dark");
    expect(relativeLuminance("#fff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000")).toBe(0);
  });
});
