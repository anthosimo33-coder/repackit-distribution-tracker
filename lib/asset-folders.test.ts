import { describe, it, expect } from "vitest";
import { resolveLinkedFolderIds } from "./asset-folders";

describe("resolveLinkedFolderIds (dual-read single→array)", () => {
  it("array multi → renvoyé tel quel (copie)", () => {
    const src = ["f1", "f2"];
    const out = resolveLinkedFolderIds({ assetFolderIds: src });
    expect(out).toEqual(["f1", "f2"]);
    expect(out).not.toBe(src); // copie, pas la même réf
  });

  it("array vide → [] (délié explicite, prime sur le legacy)", () => {
    expect(
      resolveLinkedFolderIds({ assetFolderIds: [], assetFolderId: "legacy" }),
    ).toEqual([]);
  });

  it("legacy single (array absent) → [id] — lien préservé avant migration", () => {
    expect(resolveLinkedFolderIds({ assetFolderId: "legacy" })).toEqual([
      "legacy",
    ]);
  });

  it("aucun lien → []", () => {
    expect(resolveLinkedFolderIds({})).toEqual([]);
    expect(resolveLinkedFolderIds({ assetFolderId: null })).toEqual([]);
  });
});
