import { describe, it, expect } from "vitest";
import {
  normalizeTikTokHandle,
  computeEngagement,
  toRadarDateFilter,
  parseRadarVideos,
  mergeRadarBuckets,
  isWithinDays,
  parseTrendHashtags,
  type RadarParsedVideo,
} from "./radarParsing";

/** Fabrique une vidéo parsée minimale pour les tests de bucket. */
function vid(overrides: Partial<RadarParsedVideo>): RadarParsedVideo {
  return {
    tiktokId: "1",
    url: "https://www.tiktok.com/@u/video/1",
    publishedAt: 0,
    caption: null,
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    durationSec: null,
    coverUrl: null,
    musicName: null,
    hashtags: [],
    authorHandle: null,
    authorFans: null,
    isAd: false,
    isPinned: false,
    isSlideshow: false,
    ...overrides,
  };
}

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

// ─── mergeRadarBuckets ───────────────────────────────────────────────────────

describe("mergeRadarBuckets", () => {
  it("marque populaires et récentes, populaire prioritaire (dédup)", () => {
    const recent = [vid({ tiktokId: "a" }), vid({ tiktokId: "b" })];
    const popular = [vid({ tiktokId: "b" }), vid({ tiktokId: "c" })];
    const merged = mergeRadarBuckets(recent, popular);
    // b est dans les deux → gardé UNE fois, en populaire.
    expect(merged.map((m) => [m.tiktokId, m.isPopular])).toEqual([
      ["b", true],
      ["c", true],
      ["a", false],
    ]);
  });

  it("exclut les épinglées des récentes mais les garde en populaire", () => {
    const recent = [vid({ tiktokId: "pin", isPinned: true }), vid({ tiktokId: "a" })];
    const popular = [vid({ tiktokId: "hot", isPinned: true })];
    const merged = mergeRadarBuckets(recent, popular);
    expect(merged.map((m) => m.tiktokId)).toEqual(["hot", "a"]);
    expect(merged.find((m) => m.tiktokId === "hot")?.isPopular).toBe(true);
  });

  it("déduplique aussi à l'intérieur d'un même ensemble", () => {
    const merged = mergeRadarBuckets(
      [vid({ tiktokId: "a" }), vid({ tiktokId: "a" })],
      [],
    );
    expect(merged.map((m) => m.tiktokId)).toEqual(["a"]);
  });

  it("gère deux ensembles vides", () => {
    expect(mergeRadarBuckets([], [])).toEqual([]);
  });
});

// ─── isWithinDays ────────────────────────────────────────────────────────────

describe("isWithinDays", () => {
  const now = Date.parse("2026-06-26T12:00:00.000Z");
  const DAY = 86_400_000;
  it("garde une vidéo de moins de 14 jours", () => {
    expect(isWithinDays(now - 3 * DAY, now, 14)).toBe(true);
    expect(isWithinDays(now - 13 * DAY, now, 14)).toBe(true);
    expect(isWithinDays(now, now, 14)).toBe(true);
  });
  it("rejette une vidéo de plus de 14 jours", () => {
    expect(isWithinDays(now - 20 * DAY, now, 14)).toBe(false);
    expect(isWithinDays(now - 15 * DAY, now, 14)).toBe(false);
  });
  it("tolère un léger décalage futur mais rejette le futur absurde", () => {
    expect(isWithinDays(now + DAY, now, 14)).toBe(true); // skew fuseau
    expect(isWithinDays(now + 5 * DAY, now, 14)).toBe(false);
  });
  it("rejette une date invalide / nulle", () => {
    expect(isWithinDays(0, now, 14)).toBe(false);
    expect(isWithinDays(NaN, now, 14)).toBe(false);
  });
});

// ─── parseTrendHashtags ──────────────────────────────────────────────────────

describe("parseTrendHashtags", () => {
  const sample = [
    {
      Rank: 1,
      Hashtag: "#nbadraft",
      "Hashtag ID": "16524128",
      Posts: 12968,
      "Video Views": 216705809,
      "Trend Direction": "up",
      "Top Creators": [
        { rank: 1, nickname: "NBA", handle: "@nba", followers: 5000000, country: "US" },
        { rank: 2, handle: "@espn", country: "US" },
      ],
      "TikTok URL": "https://www.tiktok.com/tag/nbadraft",
      Period: "7 days",
    },
  ];

  it("mappe les champs à clés espacées", () => {
    const [h] = parseTrendHashtags(sample);
    expect(h).toEqual({
      hashtag: "#nbadraft",
      hashtagId: "16524128",
      rank: 1,
      posts: 12968,
      videoViews: 216705809,
      trendDirection: "up",
      topCreators: [
        { handle: "@nba", nickname: "NBA", country: "US", followers: 5000000 },
        { handle: "@espn", nickname: null, country: "US", followers: null },
      ],
      tiktokUrl: "https://www.tiktok.com/tag/nbadraft",
      period: "7 days",
    });
  });

  it("rang par défaut = index+1 si Rank absent, direction inconnue → null", () => {
    const [h] = parseTrendHashtags([{ Hashtag: "#x", "Trend Direction": "weird" }]);
    expect(h.rank).toBe(1);
    expect(h.trendDirection).toBeNull();
    expect(h.topCreators).toEqual([]);
  });

  it("ignore les items sans Hashtag et le non-array", () => {
    expect(parseTrendHashtags([{ Posts: 10 }, null, "x"])).toEqual([]);
    expect(parseTrendHashtags(null)).toEqual([]);
  });
});
