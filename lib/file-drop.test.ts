import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isFileDropEnabled } from "../convex/fileDrop";
import { SNYTCH_SLUG } from "./snytch-drive";

/**
 * Ouverture du dépôt de fichiers par projet. Le test qui compte est celui du
 * REPLI : ce dégatage n'a de valeur que s'il ne change RIEN à Snytch tant que
 * personne n'a rien posé en base. Un champ absent doit donc reproduire le gate
 * `slug === "snytch"` d'avant, au caractère près.
 */

describe("isFileDropEnabled — repli exact sur le comportement d'avant", () => {
  it("champ absent + slug snytch → ouvert (Snytch inchangé, 0 migration)", () => {
    expect(isFileDropEnabled({ slug: "snytch" })).toBe(true);
    expect(isFileDropEnabled({ slug: "snytch", fileDropEnabled: undefined })).toBe(
      true,
    );
  });

  it("champ absent + tout autre slug → fermé (fermé par défaut)", () => {
    expect(isFileDropEnabled({ slug: "repackit" })).toBe(false);
    expect(isFileDropEnabled({ slug: "e2e-test" })).toBe(false);
    expect(isFileDropEnabled({ slug: "" })).toBe(false);
    // Sensible à la casse, comme l'ancien gate.
    expect(isFileDropEnabled({ slug: "Snytch" })).toBe(false);
  });

  it("un booléen explicite l'emporte dans les DEUX sens", () => {
    // Ouvrir un autre projet — c'est ce qui rend le dépôt talent testable e2e.
    expect(isFileDropEnabled({ slug: "e2e-test", fileDropEnabled: true })).toBe(
      true,
    );
    // Et couper Snytch sans déployer.
    expect(isFileDropEnabled({ slug: "snytch", fileDropEnabled: false })).toBe(
      false,
    );
  });

  it("projet introuvable → fermé (jamais ouvert par défaut)", () => {
    expect(isFileDropEnabled(null)).toBe(false);
    expect(isFileDropEnabled(undefined)).toBe(false);
  });
});

describe("parité du littéral de slug (A6 — 3 déclarations)", () => {
  it("les trois occurrences de « snytch » s'accordent", () => {
    // convex/fileDrop.ts doit rester PUR (importable client) : il ne peut pas
    // importer convex/projects.ts, qui tire tout le graphe _generated. D'où une
    // 3e déclaration du littéral, dont l'accord est verrouillé ICI plutôt que par
    // une relecture — même patron que lib/warmup-mode.test.ts.
    const fileDropSrc = readFileSync(
      new URL("../convex/fileDrop.ts", import.meta.url),
      "utf8",
    );
    const fileDropSlug = fileDropSrc.match(
      /const LEGACY_FILE_DROP_SLUG = "([^"]+)"/,
    )?.[1];
    const projectsSrc = readFileSync(
      new URL("../convex/projects.ts", import.meta.url),
      "utf8",
    );
    const projectsSlug = projectsSrc.match(
      /export const SNYTCH_SLUG = "([^"]+)"/,
    )?.[1];

    expect(fileDropSlug).toBe(SNYTCH_SLUG);
    expect(projectsSlug).toBe(SNYTCH_SLUG);
  });

  it("le repli est bien branché sur CE littéral", () => {
    expect(isFileDropEnabled({ slug: SNYTCH_SLUG })).toBe(true);
  });
});
