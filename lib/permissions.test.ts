import { describe, expect, it } from "vitest";
import {
  PERMISSION_CATALOGUE,
  PERMISSION_IDS,
  PERMISSION_ID_LITERALS,
  PERMISSION_SECTIONS,
  defaultManagerPermissions,
  grantedPermissions,
  isPermissionId,
} from "../convex/permissions";

/**
 * Le catalogue est à la fois un type, un contrôle d'accès et un écran. Ces trois
 * usages n'ont aucune raison de rester alignés tout seuls — d'où ces tests.
 */
describe("catalogue de permissions", () => {
  it("porte 21 blocs, sans doublon d'identifiant", () => {
    expect(PERMISSION_CATALOGUE).toHaveLength(21);
    expect(new Set(PERMISSION_IDS).size).toBe(21);
  });

  it("garde la liste d'objets et la liste de littéraux ALIGNÉES", () => {
    // Les deux existent parce que `PERMISSION_CATALOGUE` est typé
    // `PermissionBlock[]` (pour vérifier `section`), ce qui élargirait `id` à
    // `string`. Rien dans le langage ne les tient ensemble : ce test le fait.
    expect([...PERMISSION_IDS].sort()).toEqual(
      [...PERMISSION_ID_LITERALS].sort(),
    );
  });

  it("range chaque bloc dans une des cinq sections", () => {
    for (const b of PERMISSION_CATALOGUE) {
      expect(PERMISSION_SECTIONS, b.id).toContain(b.section);
    }
  });

  it("donne à chaque bloc un libellé et une description non vides", () => {
    for (const b of PERMISSION_CATALOGUE) {
      expect(b.label.trim().length, b.id).toBeGreaterThan(2);
      expect(b.description.trim().length, b.id).toBeGreaterThan(20);
    }
  });

  it("coche 12 blocs par défaut, et AUCUN de la section Argent", () => {
    const cochés = PERMISSION_CATALOGUE.filter((b) => b.defaultForManager);
    expect(cochés).toHaveLength(12);
    // La frontière argent, exprimée comme une propriété plutôt qu'une liste :
    // ajouter un bloc à « Argent » le rend décoché sans qu'on ait à y penser.
    expect(cochés.filter((b) => b.section === "Argent")).toEqual([]);
    expect(defaultManagerPermissions()).toHaveLength(12);
  });
});

describe("isPermissionId — appartenance, pas présence", () => {
  it("reconnaît un bloc du catalogue", () => {
    expect(isPermissionId("creators.read")).toBe(true);
    expect(isPermissionId("payments.manage")).toBe(true);
  });

  it("REFUSE tout ce qui n'y est pas", () => {
    for (const v of [
      "creators.reads", // faute de frappe
      "CREATORS.READ", // casse
      "creators", // préfixe
      "challenges.manage", // bloc RETIRÉ du catalogue (scindé en run/money)
      "*", // joker
      "",
      null,
      undefined,
      42,
      { id: "creators.read" },
    ]) {
      expect(isPermissionId(v), String(v)).toBe(false);
    }
  });
});

describe("grantedPermissions — ce qui est RÉELLEMENT accordé", () => {
  it("undefined (manager jamais coché) n'accorde RIEN", () => {
    expect(grantedPermissions(undefined).size).toBe(0);
    expect(grantedPermissions(null).size).toBe(0);
    expect(grantedPermissions([]).size).toBe(0);
  });

  it("laisse tomber les valeurs hors catalogue et garde les autres", () => {
    const g = grantedPermissions([
      "creators.read",
      "challenges.manage", // périmé : scindé, ne doit plus rien ouvrir
      "payments.manage",
      "n_importe_quoi",
    ]);
    expect([...g].sort()).toEqual(["creators.read", "payments.manage"]);
  });

  it("une liste ENTIÈREMENT hors catalogue n'accorde rien", () => {
    // Le cas qui compte : des droits écrits à la main en base, ou un catalogue
    // renommé sous les pieds d'un membership. Aucune porte ne s'ouvre.
    expect(grantedPermissions(["admin", "*", "all", "superadmin"]).size).toBe(0);
  });
});
