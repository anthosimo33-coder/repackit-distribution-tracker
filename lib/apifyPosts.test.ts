import { describe, it, expect } from "vitest";
import {
  toCount,
  tiktokPostId,
  instagramShortcode,
  parseTikTokViews,
  parseInstagramViews,
} from "./apifyPosts";

// ─── Extraction de clé TikTok ────────────────────────────────────────────────

describe("tiktokPostId", () => {
  it("extrait l'id numérique de /video/<id>", () => {
    expect(
      tiktokPostId("https://www.tiktok.com/@user/video/7234567890123456789"),
    ).toBe("7234567890123456789");
  });

  it("gère /photo/<id> (slideshow)", () => {
    expect(tiktokPostId("https://www.tiktok.com/@u/photo/7111111111111111111")).toBe(
      "7111111111111111111",
    );
  });

  it("ignore params, slash final et sous-domaines", () => {
    expect(
      tiktokPostId("https://m.tiktok.com/@u/video/7234567890123456789/?lang=fr&is_copy_url=1"),
    ).toBe("7234567890123456789");
    expect(tiktokPostId("tiktok.com/@u/video/7234567890123456789")).toBe(
      "7234567890123456789",
    );
  });

  it("retourne null pour un shortlink sans id (vm./vt.)", () => {
    expect(tiktokPostId("https://vm.tiktok.com/ZMabcdef/")).toBeNull();
    expect(tiktokPostId("https://vt.tiktok.com/ZSxyz/")).toBeNull();
  });

  it("retourne null hors TikTok / URL invalide / vide", () => {
    expect(tiktokPostId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(tiktokPostId("https://instagram.com/reel/Cxyz")).toBeNull();
    expect(tiktokPostId("pas une url")).toBeNull();
    expect(tiktokPostId("")).toBeNull();
    expect(tiktokPostId(null)).toBeNull();
    expect(tiktokPostId(undefined)).toBeNull();
  });
});

// ─── Extraction de shortcode Instagram ───────────────────────────────────────

describe("instagramShortcode", () => {
  it("extrait le code de /reel, /reels, /p, /tv", () => {
    expect(instagramShortcode("https://www.instagram.com/reel/Cabc-DEF_12/")).toBe(
      "Cabc-DEF_12",
    );
    expect(instagramShortcode("https://instagram.com/reels/Cxyz123/")).toBe(
      "Cxyz123",
    );
    expect(instagramShortcode("https://www.instagram.com/p/CpostCode9/")).toBe(
      "CpostCode9",
    );
    expect(instagramShortcode("https://www.instagram.com/tv/Ctv00000/")).toBe(
      "Ctv00000",
    );
  });

  it("ignore params et préfixe utilisateur", () => {
    expect(
      instagramShortcode(
        "https://www.instagram.com/reel/Cabc123/?utm_source=ig_web&igsh=xyz",
      ),
    ).toBe("Cabc123");
    expect(instagramShortcode("instagram.com/reel/Cabc123")).toBe("Cabc123");
  });

  it("retourne null hors Instagram / profil / vide", () => {
    expect(instagramShortcode("https://www.instagram.com/some_profile/")).toBeNull();
    expect(instagramShortcode("https://www.tiktok.com/@u/video/7")).toBeNull();
    expect(instagramShortcode("")).toBeNull();
    expect(instagramShortcode(null)).toBeNull();
  });
});

// ─── toCount ─────────────────────────────────────────────────────────────────

describe("toCount", () => {
  it("convertit number et string numérique, rejette le reste", () => {
    expect(toCount(1234)).toBe(1234);
    expect(toCount("5678")).toBe(5678);
    expect(toCount(0)).toBe(0);
    expect(toCount("")).toBeNull();
    expect(toCount("abc")).toBeNull();
    expect(toCount(null)).toBeNull();
    expect(toCount(undefined)).toBeNull();
    expect(toCount(NaN)).toBeNull();
    expect(toCount(Infinity)).toBeNull();
  });
});

// ─── Parse TikTok ────────────────────────────────────────────────────────────

describe("parseTikTokViews", () => {
  it("mappe id → {views, likes, comments, title} (playCount, diggCount, commentCount, text)", () => {
    const items = [
      {
        id: "7234567890123456789",
        playCount: 45_678,
        diggCount: 320,
        commentCount: 88,
        text: "Ma légende #fyp",
        webVideoUrl: "x",
      },
      { id: 42, playCount: "120" }, // id num + playCount string, sans likes/comments/text
    ];
    const { stats, unavailable } = parseTikTokViews(items, [
      "7234567890123456789",
      "42",
    ]);
    expect(stats["7234567890123456789"]).toEqual({
      views: 45_678,
      likes: 320,
      comments: 88,
      title: "Ma légende #fyp",
    });
    expect(stats["42"]).toEqual({
      views: 120,
      likes: null,
      comments: null,
      title: null,
    });
    expect(unavailable).toEqual([]);
  });

  it("fallback sur webVideoUrl si id absent", () => {
    const items = [
      { playCount: 99, webVideoUrl: "https://www.tiktok.com/@u/video/7000000000000000001" },
    ];
    const { stats } = parseTikTokViews(items, ["7000000000000000001"]);
    expect(stats["7000000000000000001"].views).toBe(99);
  });

  it("légende vide → title null ; légende trop longue → tronquée à 500", () => {
    const items = [
      { id: "7000000000000000010", playCount: 1, text: "   " },
      { id: "7000000000000000011", playCount: 1, text: "a".repeat(600) },
    ];
    const { stats } = parseTikTokViews(items, [
      "7000000000000000010",
      "7000000000000000011",
    ]);
    expect(stats["7000000000000000010"].title).toBeNull();
    expect(stats["7000000000000000011"].title).toHaveLength(500);
  });

  it("liste les clés demandées absentes (post privé/supprimé)", () => {
    const { stats, unavailable } = parseTikTokViews([], ["7000000000000000002"]);
    expect(stats).toEqual({});
    expect(unavailable).toEqual(["7000000000000000002"]);
  });

  it("ignore les items sans playCount exploitable sans crash", () => {
    const items = [
      { id: "7000000000000000003" }, // pas de playCount
      { id: "7000000000000000004", playCount: null },
      null,
      "garbage",
    ];
    const { stats, unavailable } = parseTikTokViews(items, [
      "7000000000000000003",
      "7000000000000000004",
    ]);
    expect(stats).toEqual({});
    expect(unavailable.sort()).toEqual([
      "7000000000000000003",
      "7000000000000000004",
    ]);
  });

  it("ne crash pas sur une réponse non-array", () => {
    expect(parseTikTokViews({ error: "boom" }, ["7"]).unavailable).toEqual(["7"]);
    expect(parseTikTokViews(null, []).stats).toEqual({});
  });
});

// ─── Parse Instagram ─────────────────────────────────────────────────────────

describe("parseInstagramViews", () => {
  it("mappe shortCode → {views, likes, comments, title} (likesCount, commentsCount, caption)", () => {
    const items = [
      {
        shortCode: "Creel001",
        videoPlayCount: 5_000,
        videoViewCount: 4_900,
        likesCount: 88,
        commentsCount: 47,
        caption: "Légende IG",
        type: "Video",
      },
      { shortCode: "Creel002", videoViewCount: 3_300, type: "Video" }, // fallback viewCount, sans likes/comments/caption
    ];
    const { stats, unavailable } = parseInstagramViews(items, [
      "Creel001",
      "Creel002",
    ]);
    expect(stats["Creel001"]).toEqual({
      views: 5_000,
      likes: 88,
      comments: 47,
      title: "Légende IG",
    });
    expect(stats["Creel002"]).toEqual({
      views: 3_300,
      likes: null,
      comments: null,
      title: null,
    });
    expect(unavailable).toEqual([]);
  });

  it("fallback sur url si shortCode absent", () => {
    const items = [
      { url: "https://www.instagram.com/reel/Creel003/", videoPlayCount: 42 },
    ];
    const { stats } = parseInstagramViews(items, ["Creel003"]);
    expect(stats["Creel003"].views).toBe(42);
  });

  it("post IMAGE (aucune vue) → unavailable, pas de crash", () => {
    const items = [{ shortCode: "Cimage01", type: "Image", likesCount: 10 }];
    const { stats, unavailable } = parseInstagramViews(items, ["Cimage01"]);
    expect(stats).toEqual({});
    expect(unavailable).toEqual(["Cimage01"]);
  });

  it("ne crash pas sur une réponse non-array", () => {
    expect(parseInstagramViews("nope", ["Cx"]).unavailable).toEqual(["Cx"]);
  });
});
