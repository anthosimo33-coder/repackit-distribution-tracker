import { describe, it, expect } from "vitest";
import { videoExtensionFromMime, submittedVideoFilename } from "./video-download";

describe("videoExtensionFromMime", () => {
  it("mappe les MIME vidéo connus", () => {
    expect(videoExtensionFromMime("video/mp4")).toBe("mp4");
    expect(videoExtensionFromMime("video/quicktime")).toBe("mov");
    expect(videoExtensionFromMime("video/webm")).toBe("webm");
  });

  it("ignore les paramètres de codecs et la casse", () => {
    expect(videoExtensionFromMime("video/mp4; codecs=avc1")).toBe("mp4");
    expect(videoExtensionFromMime("VIDEO/QUICKTIME")).toBe("mov");
  });

  it("retombe sur mp4 si inconnu, vide, null ou undefined", () => {
    expect(videoExtensionFromMime("application/octet-stream")).toBe("mp4");
    expect(videoExtensionFromMime("")).toBe("mp4");
    expect(videoExtensionFromMime(null)).toBe("mp4");
    expect(videoExtensionFromMime(undefined)).toBe("mp4");
  });
});

describe("submittedVideoFilename", () => {
  it("compose <créateur>-<campagne>.<ext> en slug ASCII", () => {
    expect(
      submittedVideoFilename({
        creatorName: "Léa Dupont",
        label: "Campagne Été 2026",
        mimeType: "video/quicktime",
      }),
    ).toBe("lea-dupont-campagne-ete-2026.mov");
  });

  it("utilise l'extension du MIME (mp4 lisible vs mov HEVC)", () => {
    expect(
      submittedVideoFilename({
        creatorName: "Bob",
        label: "Promo",
        mimeType: "video/mp4",
      }),
    ).toBe("bob-promo.mp4");
  });

  it("ignore les parties vides après slug", () => {
    expect(
      submittedVideoFilename({
        creatorName: "Bob",
        label: "!!!",
        mimeType: "video/mp4",
      }),
    ).toBe("bob.mp4");
  });

  it("retombe sur `video` si créateur et campagne sont vides", () => {
    expect(
      submittedVideoFilename({ creatorName: "", label: "", mimeType: null }),
    ).toBe("video.mp4");
  });
});
