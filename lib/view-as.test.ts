import { describe, it, expect } from "vitest";
import { VIEW_AS_ROOT, viewAsBase, portalHref } from "./view-as";

describe("viewAsBase — base path du mode view-as", () => {
  it("compose /admin/voir/<slug>/<creatorId>", () => {
    expect(viewAsBase("repackit", "cid_123")).toBe(
      "/admin/voir/repackit/cid_123",
    );
  });

  it("part bien de VIEW_AS_ROOT (sous /admin, sœur de [projectSlug])", () => {
    expect(viewAsBase("snytch", "x").startsWith(`${VIEW_AS_ROOT}/`)).toBe(true);
    expect(VIEW_AS_ROOT.startsWith("/admin/")).toBe(true);
  });
});

describe("portalHref — liens internes du portail (normal vs view-as)", () => {
  it("racine ('' ou '/') → base nu, sans slash terminal", () => {
    expect(portalHref("/app", "")).toBe("/app");
    expect(portalHref("/app", "/")).toBe("/app");
    const base = viewAsBase("repackit", "cid");
    expect(portalHref(base, "/")).toBe(base);
  });

  it("sous-chemin avec slash initial → concaténé tel quel", () => {
    expect(portalHref("/app", "/comptes")).toBe("/app/comptes");
    expect(portalHref("/app", "/paiements")).toBe("/app/paiements");
  });

  it("sous-chemin sans slash initial → normalisé", () => {
    expect(portalHref("/app", "comptes")).toBe("/app/comptes");
  });

  it("même sous-chemin, base view-as → href scopé admin (pas /app)", () => {
    const base = viewAsBase("repackit", "cid_42");
    expect(portalHref(base, "/comptes")).toBe(
      "/admin/voir/repackit/cid_42/comptes",
    );
    expect(portalHref(base, "/profil")).toBe(
      "/admin/voir/repackit/cid_42/profil",
    );
  });
});
