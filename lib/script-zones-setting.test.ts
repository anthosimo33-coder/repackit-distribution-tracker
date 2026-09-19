import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isScriptZonesEnabled } from "../convex/scriptZonesSetting";
import { SNYTCH_SLUG } from "./snytch-drive";

/**
 * Script en deux zones par projet. Le test qui compte est le REPLI : rendre
 * l'affichage réglable ne doit rien changer tant que personne n'a rien posé —
 * Snytch en deux zones, tout le reste en bloc unique.
 */
describe("isScriptZonesEnabled — repli exact sur le comportement d'avant", () => {
  it("champ absent : Snytch en deux zones, tout autre projet en bloc unique", () => {
    expect(isScriptZonesEnabled({ slug: "snytch" })).toBe(true);
    expect(isScriptZonesEnabled({ slug: "repackit" })).toBe(false);
    expect(isScriptZonesEnabled({ slug: "e2e-test" })).toBe(false);
    expect(isScriptZonesEnabled({ slug: "Snytch" })).toBe(false);
  });

  it("le réglage l'emporte dans les DEUX sens", () => {
    expect(isScriptZonesEnabled({ slug: "e2e-test", scriptZonesEnabled: true })).toBe(true);
    expect(isScriptZonesEnabled({ slug: "snytch", scriptZonesEnabled: false })).toBe(false);
  });

  it("projet introuvable → bloc unique", () => {
    expect(isScriptZonesEnabled(null)).toBe(false);
    expect(isScriptZonesEnabled(undefined)).toBe(false);
  });

  it("le littéral du repli est bien celui de Snytch", () => {
    const src = readFileSync(
      new URL("../convex/scriptZonesSetting.ts", import.meta.url),
      "utf8",
    );
    expect(src.match(/const LEGACY_SCRIPT_ZONES_SLUG = "([^"]+)"/)?.[1]).toBe(
      SNYTCH_SLUG,
    );
  });
});

/**
 * GARDE STRUCTURELLE. L'aperçu admin doit montrer ce que verra la créatrice :
 * le serveur (splitScriptZones) et l'éditeur lisent la MÊME décision. Aucun des
 * deux ne doit recomparer le slug.
 */
describe("serveur et éditeur lisent le même réglage", () => {
  const read = (rel: string) =>
    readFileSync(new URL(rel, import.meta.url), "utf8");
  const serveur = read("../convex/assignments.ts");
  const editeur = read("../app/admin/[projectSlug]/scripts/[id]/page.tsx");

  it("aucun des deux ne teste le slug", () => {
    expect(serveur).not.toMatch(/SNYTCH_SLUG|isSnytchProject\(|slug\s*[!=]==\s*"snytch"/);
    expect(editeur).not.toMatch(/SNYTCH_SLUG|isSnytchProject\(|slug\s*[!=]==\s*"snytch"/);
  });

  it("les deux passent par le réglage (présence, pas seulement absence)", () => {
    expect(serveur).toMatch(/isScriptZonesEnabled\(/);
    // Éditeur de brique ×2, aperçu d'édition, aperçu de campagne.
    expect((editeur.match(/project\.scriptZonesEnabled/g) ?? []).length).toBe(4);
  });
});
