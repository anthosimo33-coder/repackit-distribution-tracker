import { describe, it, expect } from "vitest";
import {
  isAcceptedAssetType,
  validateAssetFile,
  ASSET_MAX_SIZE_BYTES,
} from "./asset-image";

describe("isAcceptedAssetType", () => {
  it("accepte jpg / png / webp", () => {
    expect(isAcceptedAssetType("image/jpeg")).toBe(true);
    expect(isAcceptedAssetType("image/png")).toBe(true);
    expect(isAcceptedAssetType("image/webp")).toBe(true);
  });

  it("rejette vidéo et autres (images only)", () => {
    expect(isAcceptedAssetType("video/mp4")).toBe(false);
    expect(isAcceptedAssetType("image/gif")).toBe(false);
    expect(isAcceptedAssetType("application/pdf")).toBe(false);
    expect(isAcceptedAssetType("")).toBe(false);
  });
});

describe("validateAssetFile", () => {
  it("OK : image valide sous la limite", () => {
    expect(validateAssetFile({ contentType: "image/png", size: 1024 })).toEqual({
      ok: true,
    });
  });

  it("KO : non-image (vidéo) rejetée", () => {
    const r = validateAssetFile({ contentType: "video/mp4", size: 1024 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/JPG, PNG ou WebP/);
  });

  it("KO : trop lourde", () => {
    const r = validateAssetFile({
      contentType: "image/jpeg",
      size: ASSET_MAX_SIZE_BYTES + 1,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/lourde/);
  });

  it("KO : taille nulle/invalide", () => {
    expect(validateAssetFile({ contentType: "image/png", size: 0 }).ok).toBe(
      false,
    );
  });

  it("borne incluse : exactement max → OK", () => {
    expect(
      validateAssetFile({
        contentType: "image/webp",
        size: ASSET_MAX_SIZE_BYTES,
      }).ok,
    ).toBe(true);
  });
});
