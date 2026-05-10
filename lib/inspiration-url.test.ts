import { describe, it, expect } from "vitest";
import {
  detectInspirationType,
  normalizeUrl,
  type Plateforme,
  type InspirationType,
} from "./inspiration-url";

type Detection = { plateforme: Plateforme; type: InspirationType };

describe("detectInspirationType — TikTok", () => {
  const cases: Array<[string, Detection]> = [
    [
      "https://www.tiktok.com/@user/video/7123456789",
      { plateforme: "TikTok", type: "video" },
    ],
    [
      "https://tiktok.com/@user/video/7123456789",
      { plateforme: "TikTok", type: "video" },
    ],
    [
      "https://m.tiktok.com/@user/video/7123456789",
      { plateforme: "TikTok", type: "video" },
    ],
    [
      "https://www.tiktok.com/@user/video/7123456789?_r=1&_t=abc",
      { plateforme: "TikTok", type: "video" },
    ],
    [
      "https://vm.tiktok.com/ZGdAbc123/",
      { plateforme: "TikTok", type: "video" },
    ],
    [
      "https://vt.tiktok.com/ZGdAbc123",
      { plateforme: "TikTok", type: "video" },
    ],
    [
      "https://www.tiktok.com/@user",
      { plateforme: "TikTok", type: "account" },
    ],
    [
      "https://www.tiktok.com/@user/",
      { plateforme: "TikTok", type: "account" },
    ],
    [
      "https://www.tiktok.com/@user.dot",
      { plateforme: "TikTok", type: "account" },
    ],
  ];

  it.each(cases)("detects %s", (url, expected) => {
    expect(detectInspirationType(url)).toEqual(expected);
  });
});

describe("detectInspirationType — Instagram", () => {
  const cases: Array<[string, Detection]> = [
    [
      "https://www.instagram.com/reel/Cxxxx/",
      { plateforme: "Instagram", type: "video" },
    ],
    [
      "https://instagram.com/reels/Cxxxx",
      { plateforme: "Instagram", type: "video" },
    ],
    [
      "https://www.instagram.com/p/Cxxxx/?utm_source=share",
      { plateforme: "Instagram", type: "video" },
    ],
    [
      "https://www.instagram.com/username/",
      { plateforme: "Instagram", type: "account" },
    ],
    [
      "https://instagram.com/user.name",
      { plateforme: "Instagram", type: "account" },
    ],
  ];

  it.each(cases)("detects %s", (url, expected) => {
    expect(detectInspirationType(url)).toEqual(expected);
  });

  it("ne classe pas /stories/ comme account", () => {
    expect(
      detectInspirationType("https://www.instagram.com/stories/user/12345"),
    ).toBeNull();
  });

  it("ne classe pas /explore/ comme account", () => {
    expect(
      detectInspirationType("https://www.instagram.com/explore/"),
    ).toBeNull();
  });
});

describe("detectInspirationType — YouTube", () => {
  const cases: Array<[string, Detection]> = [
    [
      "https://www.youtube.com/shorts/abc123_-",
      { plateforme: "YouTube", type: "video" },
    ],
    [
      "https://m.youtube.com/shorts/abc123",
      { plateforme: "YouTube", type: "video" },
    ],
    [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      { plateforme: "YouTube", type: "video" },
    ],
    [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5s",
      { plateforme: "YouTube", type: "video" },
    ],
    [
      "https://youtu.be/dQw4w9WgXcQ",
      { plateforme: "YouTube", type: "video" },
    ],
    [
      "https://youtu.be/dQw4w9WgXcQ?si=foo",
      { plateforme: "YouTube", type: "video" },
    ],
    [
      "https://www.youtube.com/@MrBeast",
      { plateforme: "YouTube", type: "account" },
    ],
    [
      "https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA",
      { plateforme: "YouTube", type: "account" },
    ],
    [
      "https://www.youtube.com/c/PewDiePie",
      { plateforme: "YouTube", type: "account" },
    ],
    [
      "https://www.youtube.com/user/Smosh",
      { plateforme: "YouTube", type: "account" },
    ],
  ];

  it.each(cases)("detects %s", (url, expected) => {
    expect(detectInspirationType(url)).toEqual(expected);
  });
});

describe("detectInspirationType — invalid / null", () => {
  const invalids: string[] = [
    "",
    "  ",
    "https://example.com/foo",
    "https://twitter.com/user/status/123",
    "not a url",
    "https://facebook.com/page",
  ];

  it.each(invalids.map((u) => [u]))("returns null for %s", (url) => {
    expect(detectInspirationType(url)).toBeNull();
  });
});

describe("normalizeUrl", () => {
  it("trim whitespace", () => {
    expect(normalizeUrl("  https://tiktok.com/@user  ")).toBe(
      "https://tiktok.com/@user",
    );
  });

  it("préserve la casse du path (usernames case-sensitive)", () => {
    expect(normalizeUrl("https://www.youtube.com/@MrBeast")).toBe(
      "https://www.youtube.com/@MrBeast",
    );
  });
});

describe("detectInspirationType — case insensitivity", () => {
  it("match TikTok.com (capital T)", () => {
    expect(
      detectInspirationType("https://www.TikTok.com/@user/video/123"),
    ).toEqual({ plateforme: "TikTok", type: "video" });
  });

  it("match Instagram.COM (all caps domain)", () => {
    expect(
      detectInspirationType("https://www.Instagram.COM/reel/abc"),
    ).toEqual({ plateforme: "Instagram", type: "video" });
  });
});
