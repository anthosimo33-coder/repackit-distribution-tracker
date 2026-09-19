import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  accountValidationModeOf,
  isStrictAccountValidation,
} from "../convex/accountValidation";
import { SNYTCH_SLUG } from "./snytch-drive";

/**
 * Régime de VALIDATION DES COMPTES par projet. Le test qui compte est celui du
 * REPLI : rendre la règle réglable ne doit RIEN changer tant que personne n'a
 * rien posé en base — Snytch strict, tout le reste souple, comme l'ancien
 * `slug === "snytch"`.
 */
describe("accountValidationModeOf — repli exact sur le comportement d'avant", () => {
  it("champ absent : Snytch strict, tout autre projet souple", () => {
    expect(accountValidationModeOf({ slug: "snytch" })).toBe("strict");
    expect(accountValidationModeOf({ slug: "repackit" })).toBe("lenient");
    expect(accountValidationModeOf({ slug: "e2e-test" })).toBe("lenient");
    // Sensible à la casse, comme l'ancien gate.
    expect(accountValidationModeOf({ slug: "Snytch" })).toBe("lenient");
  });

  it("le réglage l'emporte dans les DEUX sens", () => {
    expect(
      accountValidationModeOf({ slug: "e2e-test", accountValidation: "strict" }),
    ).toBe("strict");
    expect(
      accountValidationModeOf({ slug: "snytch", accountValidation: "lenient" }),
    ).toBe("lenient");
  });

  it("projet introuvable → souple (l'ancien isSnytchProject répondait false)", () => {
    expect(accountValidationModeOf(null)).toBe("lenient");
    expect(isStrictAccountValidation(undefined)).toBe(false);
  });

  it("le littéral du repli est bien celui de Snytch", () => {
    expect(isStrictAccountValidation({ slug: SNYTCH_SLUG })).toBe(true);
    const src = readFileSync(
      new URL("../convex/accountValidation.ts", import.meta.url),
      "utf8",
    );
    expect(src.match(/const LEGACY_STRICT_SLUG = "([^"]+)"/)?.[1]).toBe(
      SNYTCH_SLUG,
    );
  });
});

/**
 * GARDE STRUCTURELLE. « Un compte non validé ne publie rien » n'est vrai que si
 * l'attribution ET la publication lisent le MÊME régime. Un fichier serveur qui
 * décide de la disponibilité d'un compte (`isAccountAvailable`) ne doit donc
 * JAMAIS relire le slug pour choisir ce régime : il passe par
 * `isStrictAccountValidationFor`.
 */
describe("aucun site du régime strict ne relit le slug", () => {
  const convexDir = new URL("../convex/", import.meta.url);
  const files = readdirSync(convexDir).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  );
  const src = (f: string) => readFileSync(new URL(f, convexDir), "utf8");

  it("les fichiers qui appellent isAccountAvailable n'appellent pas isSnytchProject", () => {
    const fautifs = files.filter((f) => {
      const s = src(f);
      return /isAccountAvailable\(/.test(s) && /isSnytchProject\(ctx/.test(s);
    });
    expect(fautifs).toEqual([]);
  });

  it("les sept sites passent bien par le point d'entrée unique", () => {
    // Présence, pas seulement absence : sans elle, supprimer les appels
    // laisserait la garde ci-dessus verte.
    const n = (f: string) =>
      (src(f).match(/isStrictAccountValidationFor\(/g) ?? []).length;
    expect(n("comptes.ts")).toBe(4); // dispo admin, portail, clippeur, onboarding
    expect(n("assignments.ts")).toBe(3); // validateTargets, liste assignables, publication
  });
});
