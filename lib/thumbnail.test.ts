import { describe, it, expect } from "vitest";
import {
  buildYouTubeThumbnailUrl,
  buildTikTokOEmbedUrl,
  parseOEmbedThumbnail,
} from "./thumbnail";

const VID = "dQw4w9WgXcQ";

describe("buildYouTubeThumbnailUrl", () => {
  it("construit l'URL hqdefault depuis un videoId", () => {
    expect(buildYouTubeThumbnailUrl(VID)).toBe(
      `https://img.youtube.com/vi/${VID}/hqdefault.jpg`,
    );
  });

  it("préserve les caractères _ et - du videoId", () => {
    expect(buildYouTubeThumbnailUrl("_-aB3cD4eF5")).toBe(
      "https://img.youtube.com/vi/_-aB3cD4eF5/hqdefault.jpg",
    );
  });
});

describe("buildTikTokOEmbedUrl", () => {
  it("encode l'URL de la vidéo dans le query param", () => {
    const url = "https://www.tiktok.com/@user/video/7123456789";
    expect(buildTikTokOEmbedUrl(url)).toBe(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
    );
  });
});

describe("parseOEmbedThumbnail", () => {
  it("extrait thumbnail_url d'une réponse valide", () => {
    expect(
      parseOEmbedThumbnail({ thumbnail_url: "https://cdn.tiktok.com/x.jpg" }),
    ).toBe("https://cdn.tiktok.com/x.jpg");
  });

  it("trim les espaces", () => {
    expect(parseOEmbedThumbnail({ thumbnail_url: "  https://x.jpg  " })).toBe(
      "https://x.jpg",
    );
  });

  it("retourne null si thumbnail_url absent / vide / non-string", () => {
    expect(parseOEmbedThumbnail({})).toBeNull();
    expect(parseOEmbedThumbnail({ thumbnail_url: "" })).toBeNull();
    expect(parseOEmbedThumbnail({ thumbnail_url: "   " })).toBeNull();
    expect(parseOEmbedThumbnail({ thumbnail_url: 42 })).toBeNull();
  });

  it("retourne null sur entrée non-objet (JSON inattendu)", () => {
    expect(parseOEmbedThumbnail(null)).toBeNull();
    expect(parseOEmbedThumbnail(undefined)).toBeNull();
    expect(parseOEmbedThumbnail("nope")).toBeNull();
    expect(parseOEmbedThumbnail([])).toBeNull();
  });
});
