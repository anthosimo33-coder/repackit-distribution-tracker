import { describe, it, expect } from "vitest";
import { normalizeSourceId } from "./source-id";

describe("normalizeSourceId", () => {
  it("strips .mp4 extension", () => {
    expect(normalizeSourceId("short_042.mp4")).toBe("short_042");
  });

  it("lowercases and strips uppercase .MP4", () => {
    expect(normalizeSourceId("Short_042.MP4")).toBe("short_042");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeSourceId(" short_042 ")).toBe("short_042");
  });

  it("strips .MOV extension (case-insensitive)", () => {
    expect(normalizeSourceId("short_042.MOV")).toBe("short_042");
  });

  it("leaves a bare id untouched", () => {
    expect(normalizeSourceId("short_042")).toBe("short_042");
  });

  it("strips .webm extension", () => {
    expect(normalizeSourceId("short_042.webm")).toBe("short_042");
  });

  it("does NOT strip a non-video extension", () => {
    expect(normalizeSourceId("Short_042.something")).toBe(
      "short_042.something",
    );
  });

  it("returns empty string for empty input", () => {
    expect(normalizeSourceId("")).toBe("");
  });
});
