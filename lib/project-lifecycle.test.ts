import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  LOCKED_SLUGS,
  LOGO_MAX_BYTES,
  RESERVED_SLUGS,
  deletionConfirmed,
  isSlugLocked,
  logoRefusal,
  normalizeAccentColor,
  normalizeProjectName,
  normalizeProjectSlug,
  pathWithSlug,
  previousSlugsAfterChange,
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

describe("normalizeProjectSlug", () => {
  it("accepte minuscules, chiffres et tirets internes ; met en minuscules", () => {
    expect(normalizeProjectSlug("blush")).toBe("blush");
    expect(normalizeProjectSlug("  Blush-2 ")).toBe("blush-2");
    expect(normalizeProjectSlug("a")).toBe("a");
  });

  it("refuse ce qui ne tiendrait pas dans une URL telle quelle", () => {
    for (const s of ["", " ", "blush par crush", "-blush", "blush-", "blüsh", "a/b", "a_b", "a.b"]) {
      expect(normalizeProjectSlug(s)).toBeNull();
    }
  });
});

describe("previousSlugsAfterChange", () => {
  it("l'ancienne adresse entre dans la liste", () => {
    expect(previousSlugsAfterChange(undefined, "crush", "blush")).toEqual(["crush"]);
    expect(previousSlugsAfterChange(["old"], "crush", "blush")).toEqual(["old", "crush"]);
  });

  it("revenir à une adresse passée la retire de la liste, sans doublon", () => {
    expect(previousSlugsAfterChange(["crush"], "blush", "crush")).toEqual(["blush"]);
    expect(previousSlugsAfterChange(["crush", "blush"], "blush", "crush")).toEqual(["blush"]);
  });

  it("adresse inchangée : liste inchangée", () => {
    expect(previousSlugsAfterChange(["old"], "crush", "crush")).toEqual(["old"]);
  });
});

describe("pathWithSlug", () => {
  it("réécrit le segment du projet, sur les trois familles de routes", () => {
    expect(pathWithSlug("/admin/crush/createurs", "crush", "blush")).toBe("/admin/blush/createurs");
    expect(pathWithSlug("/admin/crush", "crush", "blush")).toBe("/admin/blush");
    expect(pathWithSlug("/admin/voir/crush/abc/gains", "crush", "blush")).toBe(
      "/admin/voir/blush/abc/gains",
    );
    expect(pathWithSlug("/crush/login", "crush", "blush")).toBe("/blush/login");
  });

  it("ne touche que le premier segment égal, jamais une sous-chaîne", () => {
    expect(pathWithSlug("/admin/crush/scripts/crush", "crush", "blush")).toBe(
      "/admin/blush/scripts/crush",
    );
    expect(pathWithSlug("/admin/crushed/x", "crush", "blush")).toBe("/admin/crushed/x");
  });
});

describe("adresses figées et réservées", () => {
  /**
   * Toute adresse que le CODE nomme (constante `*_SLUG = "…"` ou lecture
   * `eq("slug", "…")`) doit être figée : sinon renommer le projet ferait
   * basculer en silence le comportement qui en dépend.
   */
  function slugsNommesDansLeCode(): string[] {
    const racine = path.join(__dirname, "..");
    const fichiers = [
      ...readdirSync(path.join(racine, "convex"))
        .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
        .map((f) => path.join(racine, "convex", f)),
      ...readdirSync(path.join(racine, "lib"))
        .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
        .map((f) => path.join(racine, "lib", f)),
    ];
    const trouves = new Set<string>();
    for (const f of fichiers) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/_SLUG = "([a-z0-9-]+)"|eq\("slug", "([a-z0-9-]+)"\)/g)) {
        trouves.add(m[1] ?? m[2]);
      }
    }
    return [...trouves].sort();
  }

  it("le lecteur voit bien les adresses nommées (présence)", () => {
    expect(slugsNommesDansLeCode()).toEqual(expect.arrayContaining(["repackit", "snytch"]));
  });

  it("chaque adresse nommée dans le code est figée", () => {
    for (const slug of slugsNommesDansLeCode()) {
      expect(isSlugLocked(slug), slug).toBe(true);
    }
  });

  it("une adresse ordinaire se change", () => {
    expect(isSlugLocked("crush")).toBe(false);
    expect(LOCKED_SLUGS.size).toBe(2);
  });

  it("chaque segment top-level de app/(app) est réservé", () => {
    const segments = readdirSync(path.join(__dirname, "..", "app", "(app)"), {
      withFileTypes: true,
    })
      .filter((d) => d.isDirectory() && !d.name.startsWith("[") && !d.name.startsWith("("))
      .map((d) => d.name);
    expect(segments).toContain("admin");
    for (const s of segments) expect(RESERVED_SLUGS.has(s), s).toBe(true);
    // Segment statique sous /admin, frère de /admin/[projectSlug].
    expect(RESERVED_SLUGS.has("voir")).toBe(true);
  });
});
