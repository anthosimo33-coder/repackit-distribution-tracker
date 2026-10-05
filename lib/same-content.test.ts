import { describe, expect, it } from "vitest";
import { sameContent } from "./same-content";

/** Forme d'une ligne de `listAssignments` — ce que compare le tableau. */
const row = {
  _id: "a1",
  creatorName: "Kelly",
  overlayText: undefined as string | undefined,
  modelVideos: [{ id: "v1", url: "https://www.tiktok.com/@x/video/1" }],
  targets: [{ platform: "TikTok", accountHandle: "@kelly", country: "FR" }],
};

/** Ce que fait Convex à chaque nouvelle version : mêmes données, objets neufs. */
const reparsed = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("sameContent", () => {
  it("une ligne inchangée, renvoyée en objets neufs, est la même", () => {
    const next = reparsed(row);
    expect(next).not.toBe(row);
    expect(sameContent(row, next)).toBe(true);
  });

  it("un champ de premier niveau modifié n'est plus la même ligne", () => {
    expect(sameContent(row, { ...reparsed(row), overlayText: "Lien en bio" })).toBe(
      false,
    );
  });

  it("une vidéo modèle ajoutée (tableau imbriqué) n'est plus la même ligne", () => {
    const next = reparsed(row);
    next.modelVideos.push({ id: "v2", url: "https://www.instagram.com/reel/2" });
    expect(sameContent(row, next)).toBe(false);
  });

  it("un compte cible renommé (objet imbriqué) n'est plus la même ligne", () => {
    const next = reparsed(row);
    next.targets[0].accountHandle = "@kelly.bis";
    expect(sameContent(row, next)).toBe(false);
  });
});
