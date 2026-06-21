import { describe, it, expect } from "vitest";
import {
  assetKind,
  isAcceptedAssetType,
  maxBytesForType,
  validateAssetFile,
  inferContentTypeFromName,
  resolveAssetContentType,
  ASSET_IMAGE_MAX_BYTES,
  ASSET_VIDEO_MAX_BYTES,
} from "./asset-file";

describe("assetKind / isAcceptedAssetType", () => {
  it("classe les images", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp"]) {
      expect(assetKind(t)).toBe("image");
      expect(isAcceptedAssetType(t)).toBe(true);
    }
  });

  it("classe les vidéos (mp4/mov/webm)", () => {
    for (const t of ["video/mp4", "video/quicktime", "video/webm"]) {
      expect(assetKind(t)).toBe("video");
      expect(isAcceptedAssetType(t)).toBe(true);
    }
  });

  it("rejette les types non supportés", () => {
    for (const t of ["image/gif", "video/avi", "application/pdf", ""]) {
      expect(assetKind(t)).toBeNull();
      expect(isAcceptedAssetType(t)).toBe(false);
    }
  });
});

describe("maxBytesForType", () => {
  it("10 Mo image / 100 Mo vidéo / null sinon", () => {
    expect(maxBytesForType("image/png")).toBe(ASSET_IMAGE_MAX_BYTES);
    expect(maxBytesForType("video/mp4")).toBe(ASSET_VIDEO_MAX_BYTES);
    expect(maxBytesForType("application/pdf")).toBeNull();
  });
});

describe("validateAssetFile", () => {
  it("image OK sous 10 Mo", () => {
    expect(validateAssetFile({ contentType: "image/png", size: 1024 })).toEqual({
      ok: true,
    });
  });

  it("vidéo OK sous 100 Mo (mais > limite image)", () => {
    expect(
      validateAssetFile({ contentType: "video/mp4", size: 50 * 1024 * 1024 }),
    ).toEqual({ ok: true });
  });

  it("image > 10 Mo rejetée (limite image, pas vidéo)", () => {
    const r = validateAssetFile({
      contentType: "image/jpeg",
      size: ASSET_IMAGE_MAX_BYTES + 1,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Image trop lourde/);
  });

  it("vidéo > 100 Mo rejetée", () => {
    const r = validateAssetFile({
      contentType: "video/quicktime",
      size: ASSET_VIDEO_MAX_BYTES + 1,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Vidéo trop lourde/);
  });

  it("type non supporté rejeté", () => {
    const r = validateAssetFile({ contentType: "video/avi", size: 1024 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Format non supporté/);
  });

  it("taille nulle rejetée", () => {
    expect(
      validateAssetFile({ contentType: "video/mp4", size: 0 }).ok,
    ).toBe(false);
  });

  it("bornes incluses : exactement max → OK", () => {
    expect(
      validateAssetFile({ contentType: "image/webp", size: ASSET_IMAGE_MAX_BYTES })
        .ok,
    ).toBe(true);
    expect(
      validateAssetFile({ contentType: "video/webm", size: ASSET_VIDEO_MAX_BYTES })
        .ok,
    ).toBe(true);
  });
});

describe("inferContentTypeFromName", () => {
  it("déduit le type depuis l'extension (insensible à la casse)", () => {
    expect(inferContentTypeFromName("clip.mp4")).toBe("video/mp4");
    expect(inferContentTypeFromName("Clip.MOV")).toBe("video/quicktime");
    expect(inferContentTypeFromName("a.webm")).toBe("video/webm");
    expect(inferContentTypeFromName("logo.PNG")).toBe("image/png");
    expect(inferContentTypeFromName("p.jpeg")).toBe("image/jpeg");
  });

  it("null si extension inconnue ou absente", () => {
    expect(inferContentTypeFromName("archive.zip")).toBeNull();
    expect(inferContentTypeFromName("noext")).toBeNull();
  });
});

describe("resolveAssetContentType (fix MIME vide pour .mp4/.mov)", () => {
  it("garde le MIME quand il est déjà accepté", () => {
    expect(
      resolveAssetContentType({ type: "video/mp4", name: "x.mp4" }),
    ).toBe("video/mp4");
  });

  it("fallback extension quand le MIME est vide (cas du bug vidéo)", () => {
    expect(resolveAssetContentType({ type: "", name: "clip.mp4" })).toBe(
      "video/mp4",
    );
    expect(
      resolveAssetContentType({ type: "application/octet-stream", name: "a.mov" }),
    ).toBe("video/quicktime");
  });

  it("null si ni MIME ni extension supportés", () => {
    expect(resolveAssetContentType({ type: "", name: "doc.pdf" })).toBeNull();
  });
});
