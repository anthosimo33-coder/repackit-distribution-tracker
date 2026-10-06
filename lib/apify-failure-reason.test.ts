import { describe, it, expect } from "vitest";
import { apifyFailureReason } from "../convex/apifyApi";

/**
 * Le motif d'échec est ce que l'écran affiche à la place du chiffre
 * (« Non mesuré — <motif> »). Le 2026-10-05, tout le relevé Instagram et
 * Facebook a échoué sur ce refus d'Apify, et l'écran disait seulement
 * « Apify en erreur (403) » : rien ne désignait le crédit épuisé.
 */
describe("apifyFailureReason — ce que l'écran dit d'un lot refusé", () => {
  it("le refus RÉEL d'Apify quand le crédit mensuel est épuisé (prod, 2026-10-05)", () => {
    expect(
      apifyFailureReason({ status: 403, message: "Monthly usage hard limit exceeded" }),
    ).toBe("crédit Apify épuisé (limite mensuelle du plan atteinte)");
  });

  it("toute autre erreur garde le statut ET le message d'Apify", () => {
    expect(apifyFailureReason({ status: 502, message: "Actor run timed out" })).toBe(
      "Apify en erreur (502) — Actor run timed out",
    );
    expect(apifyFailureReason({ status: "network", message: "fetch failed" })).toBe(
      "Apify en erreur (network) — fetch failed",
    );
  });

  it("borné à 200 caractères : un corps d'erreur bavard ne remplit pas la cellule", () => {
    const r = apifyFailureReason({ status: 500, message: "x".repeat(500) });
    expect(r.length).toBe(200);
  });
});
