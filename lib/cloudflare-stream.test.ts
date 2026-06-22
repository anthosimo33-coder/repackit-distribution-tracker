import { describe, it, expect } from "vitest";
import { mapStreamState, streamIframeUrl } from "./cloudflare-stream";

describe("mapStreamState", () => {
  it("ready → ready", () => {
    expect(mapStreamState("ready")).toBe("ready");
  });

  it("error → error", () => {
    expect(mapStreamState("error")).toBe("error");
  });

  it.each(["pendingupload", "downloading", "queued", "inprogress"])(
    "%s (transcoding) → processing",
    (state) => {
      expect(mapStreamState(state)).toBe("processing");
    },
  );

  it("insensible à la casse et aux espaces", () => {
    expect(mapStreamState("  READY ")).toBe("ready");
    expect(mapStreamState("Error")).toBe("error");
  });

  it("null / undefined / inconnu → processing (jamais ready par défaut)", () => {
    expect(mapStreamState(null)).toBe("processing");
    expect(mapStreamState(undefined)).toBe("processing");
    expect(mapStreamState("wat")).toBe("processing");
  });
});

describe("streamIframeUrl", () => {
  it("construit l'URL d'embed universelle", () => {
    expect(streamIframeUrl("abc123")).toBe(
      "https://iframe.videodelivery.net/abc123",
    );
  });

  it("encode le UID (pas d'injection dans src)", () => {
    expect(streamIframeUrl("a/b?c")).toBe(
      "https://iframe.videodelivery.net/a%2Fb%3Fc",
    );
  });
});
