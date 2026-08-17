/**
 * Tests de la taxonomie des familles d'angle (`convex/angleFamily.ts`),
 * importée depuis lib/ comme `convex/dateFr.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  ANGLE_FAMILY_SUGGESTIONS,
  ANGLE_FAMILY_MAX_LENGTH,
  normalizeAngleFamily,
  angleFamilyKey,
} from "../convex/angleFamily";

describe("suggestions", () => {
  it("propose les 7 familles de départ, sans doublon de clé", () => {
    expect(ANGLE_FAMILY_SUGGESTIONS).toEqual([
      "vérification",
      "trahison",
      "colère/accusation",
      "renoncement/fierté",
      "rechute",
      "effacement",
      "nostalgie",
    ]);
    const cles = ANGLE_FAMILY_SUGGESTIONS.map(angleFamilyKey);
    expect(new Set(cles).size).toBe(ANGLE_FAMILY_SUGGESTIONS.length);
  });

  it("chaque suggestion est déjà sous forme normalisée (rien à nettoyer)", () => {
    for (const s of ANGLE_FAMILY_SUGGESTIONS) {
      expect(normalizeAngleFamily(s)).toBe(s);
    }
  });
});

describe("normalizeAngleFamily — ce qui est STOCKÉ", () => {
  it("retire les espaces de bord et compresse les espaces internes", () => {
    expect(normalizeAngleFamily("  colère /  accusation ")).toBe(
      "colère / accusation",
    );
    expect(normalizeAngleFamily("renoncement\n\tfierté")).toBe(
      "renoncement fierté",
    );
  });

  it("PRÉSERVE la casse saisie (c'est ce que l'admin relira)", () => {
    expect(normalizeAngleFamily("Nostalgie")).toBe("Nostalgie");
    expect(normalizeAngleFamily("NOSTALGIE")).toBe("NOSTALGIE");
  });

  it("une saisie vide ou blanche vaut ABSENCE de famille, pas chaîne vide", () => {
    // La chaîne vide créerait un bucket fantôme dans les agrégats.
    expect(normalizeAngleFamily("")).toBeNull();
    expect(normalizeAngleFamily("   ")).toBeNull();
    expect(normalizeAngleFamily("\n\t ")).toBeNull();
    expect(normalizeAngleFamily(null)).toBeNull();
    expect(normalizeAngleFamily(undefined)).toBeNull();
  });

  it("borne la longueur sans couper une saisie normale", () => {
    const court = "renoncement/fierté";
    expect(normalizeAngleFamily(court)).toBe(court);

    const colle = "a".repeat(ANGLE_FAMILY_MAX_LENGTH + 25);
    const stocke = normalizeAngleFamily(colle);
    expect(stocke).toHaveLength(ANGLE_FAMILY_MAX_LENGTH);
    // Une famille pile à la borne passe INTACTE.
    const pile = "b".repeat(ANGLE_FAMILY_MAX_LENGTH);
    expect(normalizeAngleFamily(pile)).toBe(pile);
  });
});

describe("angleFamilyKey — ce qui REGROUPE", () => {
  it("plie la casse : trois orthographes, une seule famille", () => {
    const cles = ["Vérification", "vérification", "VÉRIFICATION"].map(
      angleFamilyKey,
    );
    expect(new Set(cles).size).toBe(1);
  });

  it("plie les accents : la faute de frappe ne crée pas une 2e famille", () => {
    expect(angleFamilyKey("vérification")).toBe(angleFamilyKey("verification"));
    expect(angleFamilyKey("renoncement/fierté")).toBe(
      angleFamilyKey("Renoncement/Fierte"),
    );
  });

  it("ne confond PAS deux familles réellement différentes", () => {
    // Contre-épreuve du test précédent : le pliage ne fusionne pas tout.
    expect(angleFamilyKey("trahison")).not.toBe(angleFamilyKey("nostalgie"));
    expect(angleFamilyKey("rechute")).not.toBe(angleFamilyKey("renoncement"));
  });

  it("la clé est stable quels que soient les espaces", () => {
    expect(angleFamilyKey("  colère/accusation  ")).toBe(
      angleFamilyKey("colère/accusation"),
    );
  });
});
