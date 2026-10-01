import { describe, it, expect } from "vitest";
import { mapStreamState, streamIframeUrl } from "./cloudflare-stream";
import {
  nextStreamPollDelayMs,
  STREAM_POLL_FAST_ATTEMPTS,
} from "../convex/cloudflareStreamApi";

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

describe("nextStreamPollDelayMs", () => {
  /** Durée couverte par le suivi : somme des délais jusqu'à l'abandon. */
  function totalCoveredMs(): { ms: number; attempts: number } {
    let ms = 0;
    let attempt = 1;
    for (let d = nextStreamPollDelayMs(attempt); d !== null; ) {
      ms += d;
      attempt += 1;
      d = nextStreamPollDelayMs(attempt);
    }
    return { ms, attempts: attempt };
  }

  it("relève serré (8 s) pendant la phase rapide", () => {
    expect(nextStreamPollDelayMs(1)).toBe(8_000);
    expect(nextStreamPollDelayMs(STREAM_POLL_FAST_ATTEMPTS - 1)).toBe(8_000);
  });

  it("ne s'arrête PAS à ~5 min : le relevé n° 40 en planifie un autre (cas du 01/10/2026)", () => {
    expect(nextStreamPollDelayMs(STREAM_POLL_FAST_ATTEMPTS)).toBe(60_000);
  });

  it("couvre au moins 2 h de transcoding, puis abandonne (borné)", () => {
    const { ms, attempts } = totalCoveredMs();
    expect(ms).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000);
    expect(ms).toBeLessThan(3 * 60 * 60 * 1000);
    expect(nextStreamPollDelayMs(attempts)).toBeNull();
  });
});
