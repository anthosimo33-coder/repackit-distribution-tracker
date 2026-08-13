import { describe, it, expect } from "vitest";
import {
  PLACEHOLDER_EXAMPLE_TITLE,
  isPlaceholderExampleTitle,
} from "./talent-brief";

describe("isPlaceholderExampleTitle", () => {
  it("reconnaît le placeholder historique, espaces compris", () => {
    expect(isPlaceholderExampleTitle(PLACEHOLDER_EXAMPLE_TITLE)).toBe(true);
    expect(isPlaceholderExampleTitle("  Exemple  ")).toBe(true);
  });

  it("laisse passer un titre RÉELLEMENT saisi — c'est tout l'intérêt", () => {
    // Un titre d'admin doit continuer de s'afficher : sans ce cas, autant
    // supprimer la légende pour tout le monde.
    expect(isPlaceholderExampleTitle("Exemple à reproduire au ralenti")).toBe(
      false,
    );
    expect(isPlaceholderExampleTitle("Plan serré, lumière du matin")).toBe(
      false,
    );
  });

  it("traite l'absence de titre comme un non-placeholder (rien à masquer)", () => {
    expect(isPlaceholderExampleTitle("")).toBe(false);
    expect(isPlaceholderExampleTitle(undefined)).toBe(false);
    expect(isPlaceholderExampleTitle(null)).toBe(false);
  });
});
