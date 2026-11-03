import { describe, expect, it } from "vitest";
import { partageVersPhotos } from "./partage-vers-photos";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
// iPadOS demande le site « version ordinateur » : l'UA est celui d'un Mac.
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

describe("partageVersPhotos", () => {
  it("iPhone : feuille de partage", () => {
    expect(partageVersPhotos({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe(true);
  });

  it("iPad sous iPadOS (UA de Mac + tactile) : feuille de partage", () => {
    expect(partageVersPhotos({ userAgent: MAC, maxTouchPoints: 5 })).toBe(true);
  });

  it("Mac (pas tactile) : téléchargement", () => {
    expect(partageVersPhotos({ userAgent: MAC, maxTouchPoints: 0 })).toBe(false);
  });

  it("Android : téléchargement", () => {
    expect(partageVersPhotos({ userAgent: ANDROID, maxTouchPoints: 5 })).toBe(false);
  });
});
