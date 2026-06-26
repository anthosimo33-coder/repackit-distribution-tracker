import { describe, it, expect } from "vitest";
import {
  normalizeTikTokHandle,
  computeEngagement,
  toRadarDateFilter,
  parseRadarVideos,
} from "./radarParsing";

// ─── normalizeTikTokHandle ───────────────────────────────────────────────────

describe("normalizeTikTokHandle", () => {
  it("strippe le @ et minuscule", () => {
    expect(normalizeTikTokHandle("@Khaby.Lame")).toBe("khaby.lame");
    expect(normalizeTikTokHandle("Khaby.Lame")).toBe("khaby.lame");
  });

  it("extrait le handle d'une URL de profil tiktok.com", () => {
    expect(normalizeTikTokHandle("https://www.tiktok.com/@khaby.lame")).toBe(
      "khaby.lame",
    );
    expect(
      normalizeTikTokHandle("tiktok.com/@khaby.lame?lang=fr&is_copy_url=1"),
    ).toBe("khaby.lame");
    expect(
      normalizeTikTokHandle("https://m.tiktok.com/@charlidamelio/"),
    ).toBe("charlidamelio");
  });

  it("ignore un segment vidéo dans l'URL et garde le handle", () => {
    expect(
      normalizeTikTokHandle("https://www.tiktok.com/@user1/video/7234567890123456789"),
    ).toBe("user1");
  });

  it("refuse vide, charset invalide, hors tiktok, shortlink de profil", () => {
    expect(normalizeTikTokHandle("")).toBeNull();
    expect(normalizeTikTokHandle("   ")).toBeNull();
    expect(normalizeTikTokHandle("@bad handle!")).toBeNull();
    expect(normalizeTikTokHandle("https://youtube.com/@user")).toBeNull();
    expect(normalizeTikTokHandle("https://vm.tiktok.com/ZMabcdef/")).toBeNull();
    expect(normalizeTikTokHandle(null)).toBeNull();
    expect(normalizeTikTokHandle(undefined)).toBeNull();
  });

  it("refuse un handle trop long (> 24)", () => {
    expect(normalizeTikTokHandle("a".repeat(25))).toBeNull();
    expect(normalizeTikTokHandle("a".repeat(24))).toBe("a".repeat(24));
  });
});

// ─── computeEngagement ───────────────────────────────────────────────────────

describe("computeEngagement", () => {
  it("calcule (likes+comments+shares)/vues", () => {
    expect(computeEngagement(1000, 100, 50, 50)).toBeCloseTo(0.2);
  });

  it("retourne 0 si vues ≤ 0 (jamais NaN/Infinity)", () => {
    expect(computeEngagement(0, 10, 10, 10)).toBe(0);
    expect(computeEngagement(-5, 10, 10, 10)).toBe(0);
  });

  it("tolère des entrées non finies", () => {
    expect(computeEngagement(100, NaN, 10, 10)).toBeCloseTo(0.2);
    expect(computeEngagement(NaN, 10, 10, 10)).toBe(0);
  });
});

// ─── toRadarDateFilter ───────────────────────────────────────────────────────

describe("toRadarDateFilter", () => {
  it("dérive YYYY-MM-DD UTC du dernier sync", () => {
    expect(toRadarDateFilter(Date.parse("2026-06-26T15:30:00.000Z"))).toBe(
      "2026-06-26",
    );
    expect(toRadarDateFilter(Date.parse("2026-01-02T23:59:59.000Z"))).toBe(
      "2026-01-02",
    );
  });
});

// ─── parseRadarVideos ────────────────────────────────────────────────────────

describe("parseRadarVideos", () => {
  const sample = [
    {
      id: "7655457745159720205",
      webVideoUrl: "https://www.tiktok.com/@charlidamelio/video/7655457745159720205",
      createTimeISO: "2026-06-25T22:06:06.000Z",
      createTime: 1781820366,
      text: "dc @Darrion G",
      playCount: 2_300_000,
      diggCount: 371_500,
      commentCount: 2239,
      shareCount: 5786,
      collectCount: 13_646,
      videoMeta: { duration: 11, coverUrl: "https://p16.tiktokcdn.com/cover.webp" },
      musicMeta: { musicName: "original sound" },
      authorMeta: { name: "charlidamelio", nickName: "charli", fans: 155_000_000 },
      hashtags: [{ name: "fyp" }, { name: "dance" }],
      isAd: false,
      isPinned: false,
      isSlideshow: false,
    },
  ];

  it("mappe tous les champs d'une vidéo profil", () => {
    const [v] = parseRadarVideos(sample);
    expect(v).toEqual({
      tiktokId: "7655457745159720205",
      url: "https://www.tiktok.com/@charlidamelio/video/7655457745159720205",
      publishedAt: Date.parse("2026-06-25T22:06:06.000Z"),
      caption: "dc @Darrion G",
      views: 2_300_000,
      likes: 371_500,
      comments: 2239,
      shares: 5786,
      saves: 13_646,
      durationSec: 11,
      coverUrl: "https://p16.tiktokcdn.com/cover.webp",
      musicName: "original sound",
      hashtags: ["fyp", "dance"],
      authorHandle: "charlidamelio",
      authorFans: 155_000_000,
      isAd: false,
      isPinned: false,
      isSlideshow: false,
    });
  });

  it("met les stats manquantes à 0 et reconstruit l'URL depuis le handle", () => {
    const [v] = parseRadarVideos([
      { id: 42, authorMeta: { name: "user1" }, createTime: 1700000000 },
    ]);
    expect(v.tiktokId).toBe("42");
    expect(v.url).toBe("https://www.tiktok.com/@user1/video/42");
    expect(v.views).toBe(0);
    expect(v.likes).toBe(0);
    expect(v.saves).toBe(0);
    expect(v.publishedAt).toBe(1700000000 * 1000);
    expect(v.durationSec).toBeNull();
    expect(v.coverUrl).toBeNull();
    expect(v.hashtags).toEqual([]);
  });

  it("récupère l'id depuis webVideoUrl si item.id absent", () => {
    const [v] = parseRadarVideos([
      { webVideoUrl: "https://www.tiktok.com/@u/video/7111111111111111111" },
    ]);
    expect(v.tiktokId).toBe("7111111111111111111");
  });

  it("ignore les items sans id exploitable et le JSON non-array", () => {
    expect(parseRadarVideos([{ playCount: 10 }, null, "x"])).toEqual([]);
    expect(parseRadarVideos(null)).toEqual([]);
    expect(parseRadarVideos({})).toEqual([]);
  });

  it("accepte des hashtags en chaînes brutes", () => {
    const [v] = parseRadarVideos([
      { id: "1", hashtags: ["fyp", "  ", { name: "pourtoi" }] },
    ]);
    expect(v.hashtags).toEqual(["fyp", "pourtoi"]);
  });
});
