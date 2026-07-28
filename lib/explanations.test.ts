import { describe, it, expect } from "vitest";
import { EXPLAIN } from "../components/analytics/hub/explanations";

/**
 * GARDE-FOU point 3 : les « i » explicatifs suivent des règles de rédaction
 * strictes (le point le plus important de la passe). Ce test échoue si une
 * explication les enfreint : trois phrases maximum, aucun tiret cadratin. Ces deux
 * règles sont mécaniquement vérifiables ; le reste (français simple, aucun jargon,
 * dire à quoi sert le chiffre) relève de la relecture.
 */

const entries = Object.entries(EXPLAIN);

/** Compte les phrases : groupes de ponctuation finale (. ! ?). */
function sentenceCount(text: string): number {
  return (text.match(/[.!?]+/g) ?? []).length;
}

describe("copie des « i » explicatifs", () => {
  it("couvre bien plusieurs cartes", () => {
    expect(entries.length).toBeGreaterThan(15);
  });

  for (const [key, text] of entries) {
    describe(key, () => {
      it("n'est pas vide", () => {
        expect(text.trim().length).toBeGreaterThan(0);
      });
      it("ne contient aucun tiret cadratin", () => {
        expect(text).not.toContain("—"); // —
        expect(text).not.toContain("–"); // – (demi-cadratin, par prudence)
      });
      it("fait au plus trois phrases", () => {
        expect(sentenceCount(text)).toBeLessThanOrEqual(3);
        expect(sentenceCount(text)).toBeGreaterThanOrEqual(1);
      });
    });
  }
});
