import { describe, it, expect } from "vitest";
import {
  videoExamplePlatform,
  isTikTokShortlink,
  isTikTokHost,
} from "./model-video-embed";

describe("videoExamplePlatform — Plateforme → identifiant VideoExample", () => {
  it("mappe les trois plateformes", () => {
    expect(videoExamplePlatform("TikTok")).toBe("tiktok");
    expect(videoExamplePlatform("Instagram")).toBe("instagram");
    expect(videoExamplePlatform("YouTube")).toBe("youtube");
  });
});

describe("isTikTokShortlink — vm./vt.tiktok.com", () => {
  it("détecte les shortlinks vm/vt", () => {
    expect(isTikTokShortlink("https://vm.tiktok.com/ZNRT1H5GN/")).toBe(true);
    expect(isTikTokShortlink("https://vt.tiktok.com/ZSabc123/")).toBe(true);
    expect(isTikTokShortlink("HTTPS://VM.TIKTOK.COM/Xy9/")).toBe(true);
  });

  it("ne matche pas une URL canonique ni une autre plateforme", () => {
    expect(
      isTikTokShortlink("https://www.tiktok.com/@dawoodzahidd/video/7638012892847066390"),
    ).toBe(false);
    expect(isTikTokShortlink("https://www.instagram.com/reel/DRSPmo2DEfd/")).toBe(false);
    expect(isTikTokShortlink("https://youtu.be/abc123")).toBe(false);
  });
});

describe("isTikTokHost — garde anti-SSRF de la cible résolue", () => {
  it("accepte les hosts tiktok.com", () => {
    expect(isTikTokHost("https://www.tiktok.com/@u/video/123")).toBe(true);
    expect(isTikTokHost("https://tiktok.com/@u/video/123")).toBe(true);
    expect(isTikTokHost("https://m.tiktok.com/@u/video/123")).toBe(true);
  });

  it("rejette tout autre host (et les URLs invalides)", () => {
    expect(isTikTokHost("https://evil.example.com/")).toBe(false);
    expect(isTikTokHost("https://tiktok.com.evil.com/")).toBe(false);
    expect(isTikTokHost("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isTikTokHost("not a url")).toBe(false);
  });
});
