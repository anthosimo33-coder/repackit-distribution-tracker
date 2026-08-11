import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  CREATOR_KINDS,
  KIND_LABELS,
  isPortalRole,
  kindForRole,
  resolveCreatorKind,
  roleForKind,
  type CreatorKind,
} from "../convex/roles";
import { PORTAL_PATH, portalPathForRole } from "./portal-path";

/**
 * Rôles de portail — le mapping `creators.kind` ↔ `memberships.role` est la
 * charnière de sûreté de tout le chantier : c'est lui qui garantit qu'un talent ou
 * un clippeur ne peut PAS entrer par une fonction créateur existante. Les tests
 * portent donc autant sur l'algèbre (bijection, défauts) que sur l'accord avec le
 * SCHÉMA (les littéraux déclarés dans convex/schema.ts).
 */
describe("resolveCreatorKind — défaut partenaire", () => {
  it("absent / null / valeur inconnue → partner (0 migration)", () => {
    expect(resolveCreatorKind(undefined)).toBe("partner");
    expect(resolveCreatorKind(null)).toBe("partner");
    expect(resolveCreatorKind("")).toBe("partner");
    expect(resolveCreatorKind("Talent")).toBe("partner"); // casse ≠ littéral
    expect(resolveCreatorKind("influenceur")).toBe("partner");
  });

  it("valeurs connues rendues telles quelles", () => {
    expect(resolveCreatorKind("partner")).toBe("partner");
    expect(resolveCreatorKind("talent")).toBe("talent");
    expect(resolveCreatorKind("clipper")).toBe("clipper");
  });
});

describe("roleForKind / kindForRole — bijection", () => {
  it("une fiche SANS kind reste un créateur partenaire (comportement d'avant)", () => {
    expect(roleForKind(undefined)).toBe("creator");
  });

  it("chaque population a son littéral de membership PROPRE", () => {
    expect(roleForKind("partner")).toBe("creator");
    expect(roleForKind("talent")).toBe("talent");
    expect(roleForKind("clipper")).toBe("clipper");
    // Aucun partage de littéral : c'est ce qui fait que requireCreator
    // (role === "creator") rejette mécaniquement talents et clippeurs.
    const roles = CREATOR_KINDS.map((k) => roleForKind(k));
    expect(new Set(roles).size).toBe(CREATOR_KINDS.length);
  });

  it("kindForRole est la réciproque exacte de roleForKind", () => {
    for (const kind of CREATOR_KINDS) {
      expect(kindForRole(roleForKind(kind))).toBe(kind);
    }
  });

  it("admin et valeurs inconnues n'ouvrent AUCUN portail", () => {
    for (const role of ["admin", "superadmin", "member", "", null, undefined]) {
      expect(kindForRole(role)).toBeNull();
      expect(isPortalRole(role)).toBe(false);
      expect(portalPathForRole(role)).toBeNull();
    }
  });

  it("isPortalRole reconnaît les trois rôles de portail", () => {
    for (const kind of CREATOR_KINDS) {
      expect(isPortalRole(roleForKind(kind))).toBe(true);
    }
  });
});

describe("portal-path — table de redirection", () => {
  it("un portail DISTINCT par rôle (aucune collision de chemin)", () => {
    const paths = Object.values(PORTAL_PATH);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("chaque rôle de portail a un chemin, et c'est celui attendu", () => {
    expect(portalPathForRole("creator")).toBe("/app");
    expect(portalPathForRole("talent")).toBe("/talent");
    expect(portalPathForRole("clipper")).toBe("/clip");
  });
});

// ─── Accord avec le SCHÉMA (source de vérité des littéraux) ───────────────────

function schemaLiterals(table: string, field: string): string[] {
  const src = readFileSync(
    new URL("../convex/schema.ts", import.meta.url),
    "utf8",
  );
  const tableStart = src.indexOf(`  ${table}: defineTable(`);
  expect(tableStart).toBeGreaterThan(-1);
  const fieldStart = src.indexOf(`    ${field}: v.`, tableStart);
  expect(fieldStart).toBeGreaterThan(-1);
  // Fin du champ = première ligne `    })` / `    ),` au même niveau, ou le champ
  // suivant. On borne à 40 lignes : les unions visées sont courtes.
  const block = src.slice(fieldStart).split("\n").slice(0, 40).join("\n");
  const end = block.indexOf("\n    ),");
  const scoped = end === -1 ? block.split("\n")[0] : block.slice(0, end);
  return [...scoped.matchAll(/v\.literal\("([^"]+)"\)/g)].map((m) => m[1]);
}

describe("accord code ↔ schéma", () => {
  it("memberships.role déclare admin + les 3 rôles de portail, rien d'autre", () => {
    const literals = schemaLiterals("memberships", "role");
    expect(new Set(literals)).toEqual(
      new Set(["admin", ...CREATOR_KINDS.map((k) => roleForKind(k))]),
    );
  });

  it("creators.kind déclare exactement CREATOR_KINDS", () => {
    const literals = schemaLiterals("creators", "kind");
    expect(new Set(literals)).toEqual(new Set<string>(CREATOR_KINDS));
  });

  it("chaque population a un libellé FR (aucun terme technique à l'écran)", () => {
    for (const kind of CREATOR_KINDS) {
      const label = KIND_LABELS[kind as CreatorKind];
      expect(label.singular.length).toBeGreaterThan(0);
      expect(label.plural.length).toBeGreaterThan(0);
    }
  });
});
