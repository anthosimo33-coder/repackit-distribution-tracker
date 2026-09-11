import { describe, it, expect } from "vitest";
import { windowToMs } from "./market-window";
import { hogDateTime } from "./hog-window";

/**
 * Traduction de la fenêtre du hub en bornes d'instants. Ce qui se joue : le
 * DERNIER jour de la période. Lu à minuit, il disparaît — 24 h de revenu et de
 * coût en moins, sans que rien à l'écran ne le dise.
 */
describe("windowToMs", () => {
  it("couvre le dernier jour EN ENTIER", () => {
    const { to } = windowToMs({ from: "2026-09-01", to: "2026-09-10" });
    // 10/09 23:59:59.999 Paris = 21:59:59.999 UTC (été).
    expect(hogDateTime(to)).toBe("2026-09-10 21:59:59");
  });

  it("commence au premier instant du premier jour", () => {
    const { from } = windowToMs({ from: "2026-09-01", to: "2026-09-10" });
    expect(hogDateTime(from)).toBe("2026-08-31 22:00:00");
  });

  it("un seul jour reste un jour plein, pas un instant", () => {
    const { from, to } = windowToMs({ from: "2026-07-23", to: "2026-07-23" });
    expect(to - from).toBe(86_400_000 - 1);
  });

  it("suit le changement d'heure au lieu de supposer UTC+1", () => {
    // Nuit du 25/10/2026 : le jour dure 25 h. Une borne calculée sur un
    // décalage figé perdrait (ou doublerait) une heure de paiements.
    const { from, to } = windowToMs({ from: "2026-10-25", to: "2026-10-25" });
    expect(to - from).toBe(25 * 3_600_000 - 1);
  });
});
