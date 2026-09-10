import { describe, it, expect } from "vitest";
import { pickFaceCompte, type CompteFace } from "../convex/creatorAvatar";

/** Comptes à la forme de la prod : handles réels, dates espacées de semaines. */
function compte(over: Partial<CompteFace> & { createdAt: number }): CompteFace {
  return { plateforme: "TikTok", hasAvatar: true, ...over };
}

const LE_2_MARS = Date.parse("2026-03-02T09:14:00Z");
const LE_28_AVRIL = Date.parse("2026-04-28T17:41:00Z");
const LE_11_JUIN = Date.parse("2026-06-11T08:02:00Z");

describe("pickFaceCompte", () => {
  it("aucun compte, ou aucun avec photo → null (l'écran garde l'initiale)", () => {
    expect(pickFaceCompte([])).toBeNull();
    expect(
      pickFaceCompte([compte({ createdAt: LE_2_MARS, hasAvatar: false })]),
    ).toBeNull();
  });

  it("ignore les plateformes sans photo collectée (Instagram, YouTube)", () => {
    const insta = compte({ createdAt: LE_2_MARS, plateforme: "Instagram" });
    const yt = compte({ createdAt: LE_28_AVRIL, plateforme: "YouTube" });
    expect(pickFaceCompte([insta, yt])).toBeNull();
  });

  it("à égalité, le PLUS ANCIEN gagne — quel que soit l'ordre d'entrée", () => {
    const premier = compte({ createdAt: LE_2_MARS });
    const second = compte({ createdAt: LE_11_JUIN });
    expect(pickFaceCompte([second, premier])).toBe(premier);
    expect(pickFaceCompte([premier, second])).toBe(premier);
  });

  it("un compte ARCHIVÉ passe après un compte actif, même plus récent", () => {
    const archiveAncien = compte({ createdAt: LE_2_MARS, status: "archived" });
    const actifRecent = compte({ createdAt: LE_11_JUIN, status: "warmup" });
    expect(pickFaceCompte([archiveAncien, actifRecent])).toBe(actifRecent);
  });

  it("un compte GÉRÉ PAR L'ÉQUIPE passe après un compte à elle", () => {
    const gereAncien = compte({ createdAt: LE_2_MARS, managedByAdmin: true });
    const sienRecent = compte({ createdAt: LE_28_AVRIL });
    expect(pickFaceCompte([gereAncien, sienRecent])).toBe(sienRecent);
  });

  it("l'archivage l'emporte sur la gestion — l'ordre des critères tient", () => {
    // Actif MAIS géré par l'équipe, contre archivé et à elle : c'est l'actif
    // qui gagne. Si les deux critères étaient inversés, ce test tomberait.
    const actifGere = compte({ createdAt: LE_11_JUIN, managedByAdmin: true });
    const archiveSien = compte({ createdAt: LE_2_MARS, status: "archived" });
    expect(pickFaceCompte([archiveSien, actifGere])).toBe(actifGere);
  });

  it("aucun critère n'ÉLIMINE : le seul compte avec photo est choisi", () => {
    const seul = compte({
      createdAt: LE_2_MARS,
      status: "archived",
      managedByAdmin: true,
    });
    const sansPhoto = compte({ createdAt: LE_28_AVRIL, hasAvatar: false });
    expect(pickFaceCompte([seul, sansPhoto])).toBe(seul);
  });
});
