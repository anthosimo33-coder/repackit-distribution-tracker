import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  LOGO_MAX_BYTES,
  deletionConfirmed,
  logoRefusal,
  normalizeAccentColor,
  normalizeProjectName,
} from "../convex/projectLifecycleRules";
import { HORS_PURGE, TABLES_PURGEES } from "../convex/projectPurgeTables";

/**
 * Tables du schéma qui portent un `projectId`, lues dans le SOURCE de
 * convex/schema.ts — la vérité que la purge doit couvrir, pas une liste
 * recopiée qui vieillirait avec elle.
 */
function tablesAvecProjectId(): string[] {
  const src = readFileSync(
    path.join(__dirname, "..", "convex", "schema.ts"),
    "utf8",
  );
  const debuts = [...src.matchAll(/^ {2}(\w+): defineTable\(/gm)].map((m) => ({
    nom: m[1],
    i: m.index,
  }));
  return debuts
    .filter((t, k) => {
      const corps = src
        .slice(t.i, k + 1 < debuts.length ? debuts[k + 1].i : src.length)
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*)/.test(l))
        .join("\n");
      return /\n\s+projectId: (v\.optional\()?v\.id\("projects"\)/.test(corps);
    })
    .map((t) => t.nom);
}

describe("suppression d'un projet — aucune table oubliée", () => {
  it("le schéma porte bien des tables à projectId (le lecteur n'est pas aveugle)", () => {
    const tables = tablesAvecProjectId();
    // Présence : sans elle, l'égalité suivante passerait sur deux listes vides.
    expect(tables).toContain("publications");
    expect(tables).toContain("metricSnapshots");
    expect(tables.length).toBeGreaterThan(40);
  });

  it("chaque table à projectId est purgée OU exclue avec une raison, et rien d'autre", () => {
    const couvertes = [...TABLES_PURGEES, ...Object.keys(HORS_PURGE)].sort();
    expect(couvertes).toEqual(tablesAvecProjectId().sort());
  });

  it("aucune table n'est à la fois purgée et exclue, ni listée deux fois", () => {
    expect(new Set(TABLES_PURGEES).size).toBe(TABLES_PURGEES.length);
    for (const t of TABLES_PURGEES) expect(HORS_PURGE[t]).toBeUndefined();
  });

  it("les comptes partent en premier et les caches en dernier (relevés en vol)", () => {
    expect(TABLES_PURGEES[0]).toBe("comptes");
    expect(TABLES_PURGEES.slice(-4)).toEqual([
      "leaderboardCache",
      "dashboardCache",
      "posthogCache",
      "posthogWindowCache",
    ]);
  });
});

describe("normalizeAccentColor", () => {
  it("accepte #rrggbb et la forme courte, rend du minuscule", () => {
    expect(normalizeAccentColor("#FF5200")).toBe("#ff5200");
    expect(normalizeAccentColor("  #7c3aed ")).toBe("#7c3aed");
    expect(normalizeAccentColor("#F52")).toBe("#ff5522");
  });

  it("refuse tout ce qui partirait en CSS arbitraire", () => {
    for (const s of ["", "ff5200", "#ff52", "red", "#ff5200;display:none", "url(x)", "#gg0000"]) {
      expect(normalizeAccentColor(s)).toBeNull();
    }
  });
});

describe("normalizeProjectName", () => {
  it("nettoie les espaces, refuse le vide", () => {
    expect(normalizeProjectName("  Thea   App ")).toBe("Thea App");
    expect(normalizeProjectName("   ")).toBeNull();
  });
});

describe("logoRefusal", () => {
  it("image légère acceptée, autre type ou trop lourde refusée", () => {
    expect(logoRefusal({ contentType: "image/png", size: 48_000 })).toBeNull();
    expect(logoRefusal({ contentType: "image/svg+xml", size: 3_000 })).toBeNull();
    expect(logoRefusal({ contentType: "application/pdf", size: 3_000 })).toBe("not_image");
    expect(logoRefusal({ contentType: undefined, size: 3_000 })).toBe("not_image");
    expect(logoRefusal({ contentType: "image/jpeg", size: LOGO_MAX_BYTES + 1 })).toBe("too_large");
    expect(logoRefusal({ contentType: "image/jpeg", size: LOGO_MAX_BYTES })).toBeNull();
  });
});

describe("deletionConfirmed", () => {
  it("exige le nom exact, casse comprise", () => {
    expect(deletionConfirmed("Thea App", "Thea App")).toBe(true);
    expect(deletionConfirmed("Thea App", "  Thea App ")).toBe(true);
    expect(deletionConfirmed("Thea App", "thea app")).toBe(false);
    expect(deletionConfirmed("Thea App", "Thea")).toBe(false);
    expect(deletionConfirmed("Thea App", "")).toBe(false);
  });
});
