import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  CREATOR_KINDS,
  KIND_LABELS,
  TEAM_ROLES,
  isPortalRole,
  isTeamRole,
  kindForRole,
  promotionToAdminDecision,
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
  it("memberships.role déclare admin + manager + les 3 rôles de portail, rien d'autre", () => {
    // `manager` est un rôle d'ADMINISTRATION RESTREINTE, pas une population :
    // il n'a pas de fiche `creators`, donc il ne dérive d'aucun CREATOR_KIND et
    // s'écrit à la main ici. C'est aussi pour ça que `isPortalRole` le rejette
    // (test ci-dessous) : un manager n'a AUCUN portail où être redirigé.
    const literals = schemaLiterals("memberships", "role");
    expect(new Set(literals)).toEqual(
      new Set(["admin", "manager", ...CREATOR_KINDS.map((k) => roleForKind(k))]),
    );
  });

  it("« manager » n'est PAS un rôle de portail", () => {
    // Garde de non-régression du routage : si `manager` devenait un PortalRole,
    // `portalPathForRole` l'enverrait sur un portail créateur au lieu de l'app
    // interne, et `getMyPortal` le sortirait de l'admin. Les deux se lisent
    // comme un bug d'écran alors que c'est une erreur de classification.
    expect(isPortalRole("manager")).toBe(false);
    expect(kindForRole("manager")).toBeNull();
  });

  it("TOUT rôle du schéma est classé : équipe OU portail, jamais ni l'un ni l'autre", () => {
    // LE TEST QUI MANQUAIT, et le défaut qu'il attrape est celui qu'on répare :
    // `manager` était déclaré au schéma sans appartenir à aucun des deux groupes
    // de routage. Il n'était donc NI redirigé vers l'app interne (réservée au
    // littéral "admin") NI vers un portail (`portalPathForRole` → null) : le
    // résolveur d'accueil le rangeait dans « aucun espace ».
    //
    // La partition est exigée SUR LE SCHÉMA, pas sur une liste écrite à la main :
    // ajouter demain un littéral à `memberships.role` sans dire de quel côté il
    // tombe casse ici, avant qu'une personne réelle le découvre à l'écran.
    const orphelins = schemaLiterals("memberships", "role").filter(
      (r) => !isTeamRole(r) && !isPortalRole(r),
    );
    expect(orphelins).toEqual([]);
  });

  it("les deux groupes sont DISJOINTS (aucun rôle des deux côtés)", () => {
    // L'autre moitié de la partition. Un rôle à la fois équipe et portail ferait
    // dépendre l'atterrissage de l'ordre des `if` — deux lectures possibles du
    // même état, ce qui est pire qu'un refus.
    for (const r of schemaLiterals("memberships", "role")) {
      expect(isTeamRole(r) && isPortalRole(r), r).toBe(false);
    }
  });
});

describe("isTeamRole — appartenance, pas négation", () => {
  it("reconnaît les deux rôles qui ouvrent l'app interne", () => {
    expect(isTeamRole("admin")).toBe(true);
    expect(isTeamRole("manager")).toBe(true);
    expect([...TEAM_ROLES]).toEqual(["admin", "manager"]);
  });

  it("REFUSE tout le reste — y compris ce qui n'est pas un rôle de portail", () => {
    // Le cas qui compte : écrite `!isPortalRole(role)`, la fonction ouvrirait
    // l'app interne à un littéral inconnu (rôle renommé, valeur écrite à la main
    // en base, chaîne venue d'un appelant non typé). Même discipline que
    // `isPermissionId` : on autorise par APPARTENANCE au groupe.
    for (const r of [
      "superadmin", // rôle GLOBAL (users.role), jamais un membership
      "member",
      "Admin", // casse ≠ littéral
      "manager ",
      "editeur",
      "*",
      "",
      null,
      undefined,
    ]) {
      expect(isTeamRole(r), String(r)).toBe(false);
    }
  });

  it("aucun rôle de portail n'ouvre l'app interne", () => {
    for (const kind of CREATOR_KINDS) {
      expect(isTeamRole(roleForKind(kind)), kind).toBe(false);
    }
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

/**
 * PROMOTION EN ADMIN — la seule porte qui donne accès à tout un projet sans
 * cocher une case. Elle vit en ligne de commande (convex/memberPermissions.ts) ;
 * ces assertions sont ce qui l'empêche de s'ouvrir sur la mauvaise personne.
 */
describe("promotionToAdminDecision — qui se promeut, et qui pas", () => {
  it("seul « manager » monte ; « admin » est un no-op rejouable", () => {
    expect(promotionToAdminDecision("manager")).toBe("promote");
    expect(promotionToAdminDecision("admin")).toBe("noop");
  });

  it("AUCUN rôle de portail ne se promeut (le rôle est écrasé, pas ajouté)", () => {
    // Promouvoir le membership d'une créatrice lui RETIRERAIT son espace :
    // `requireCreator` exige le littéral "creator". Le refus est donc la seule
    // issue correcte — et il vaut pour les trois populations.
    for (const kind of CREATOR_KINDS) {
      expect(promotionToAdminDecision(roleForKind(kind))).toBe("refuse");
    }
  });

  it("valeur absente, vide ou inconnue → refus (défaut fermé)", () => {
    expect(promotionToAdminDecision(undefined)).toBe("refuse");
    expect(promotionToAdminDecision(null)).toBe("refuse");
    expect(promotionToAdminDecision("")).toBe("refuse");
    expect(promotionToAdminDecision("Manager")).toBe("refuse"); // casse ≠ littéral
    expect(promotionToAdminDecision("superadmin")).toBe("refuse"); // ≠ memberships
  });

  it("chaque littéral du SCHÉMA a une décision, et une seule est « promote »", () => {
    // Le jour où `memberships.role` gagne un littéral, il arrive ici en "refuse"
    // et ce test tombe : ajouter un rôle oblige à DIRE s'il se promeut.
    const literals = schemaLiterals("memberships", "role");
    const promouvables = literals.filter(
      (r) => promotionToAdminDecision(r) === "promote",
    );
    expect(promouvables).toEqual(["manager"]);
    expect(literals.filter((r) => promotionToAdminDecision(r) === "noop")).toEqual(
      ["admin"],
    );
  });
});
