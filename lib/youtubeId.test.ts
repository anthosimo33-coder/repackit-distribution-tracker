import { describe, it, expect } from "vitest";
import {
  extractYouTubeId,
  chunk,
  parseVideoStats,
} from "./youtubeId";

// Un videoId réaliste (11 caractères, avec _ et -).
const VID = "dQw4w9WgXcQ";
const VID2 = "_-aB3cD4eF5";

describe("extractYouTubeId — formats valides", () => {
  it("watch?v=ID", () => {
    expect(extractYouTubeId(`https://www.youtube.com/watch?v=${VID}`)).toBe(VID);
    expect(extractYouTubeId(`https://youtube.com/watch?v=${VID}`)).toBe(VID);
  });

  it("watch?v=ID avec params additionnels (&t=, &list=, &ab_channel)", () => {
    expect(
      extractYouTubeId(`https://www.youtube.com/watch?v=${VID}&t=42s`),
    ).toBe(VID);
    expect(
      extractYouTubeId(
        `https://www.youtube.com/watch?v=${VID}&list=PLxyz&index=2`,
      ),
    ).toBe(VID);
    // v n'est pas le premier param.
    expect(
      extractYouTubeId(`https://www.youtube.com/watch?list=PLxyz&v=${VID}`),
    ).toBe(VID);
  });

  it("youtu.be/ID (+ ?si=, ?t=)", () => {
    expect(extractYouTubeId(`https://youtu.be/${VID}`)).toBe(VID);
    expect(extractYouTubeId(`https://youtu.be/${VID}?si=AbCdEf`)).toBe(VID);
    expect(extractYouTubeId(`https://youtu.be/${VID}?t=30`)).toBe(VID);
  });

  it("shorts/ID", () => {
    expect(extractYouTubeId(`https://www.youtube.com/shorts/${VID}`)).toBe(VID);
    expect(extractYouTubeId(`https://youtube.com/shorts/${VID}?feature=share`)).toBe(
      VID,
    );
  });

  it("embed/ID, live/ID, v/ID", () => {
    expect(extractYouTubeId(`https://www.youtube.com/embed/${VID}`)).toBe(VID);
    expect(extractYouTubeId(`https://www.youtube.com/live/${VID}`)).toBe(VID);
    expect(extractYouTubeId(`https://www.youtube.com/v/${VID}`)).toBe(VID);
  });

  it("m.youtube.com et music.youtube.com", () => {
    expect(extractYouTubeId(`https://m.youtube.com/watch?v=${VID}`)).toBe(VID);
    expect(extractYouTubeId(`https://music.youtube.com/watch?v=${VID}`)).toBe(
      VID,
    );
  });

  it("sans scheme (collé)", () => {
    expect(extractYouTubeId(`youtu.be/${VID}`)).toBe(VID);
    expect(extractYouTubeId(`www.youtube.com/watch?v=${VID}`)).toBe(VID);
  });

  it("id avec _ et - (caractères valides)", () => {
    expect(extractYouTubeId(`https://youtu.be/${VID2}`)).toBe(VID2);
    expect(extractYouTubeId(`https://www.youtube.com/shorts/${VID2}`)).toBe(VID2);
  });

  it("espaces autour de l'URL tolérés", () => {
    expect(extractYouTubeId(`  https://youtu.be/${VID}  `)).toBe(VID);
  });
});

describe("extractYouTubeId — invalides → null", () => {
  it("URL non-YouTube", () => {
    expect(extractYouTubeId("https://www.tiktok.com/@x/video/123")).toBeNull();
    expect(extractYouTubeId("https://www.instagram.com/reel/abc/")).toBeNull();
    expect(extractYouTubeId("https://vimeo.com/123456")).toBeNull();
    // Domaine piège qui contient "youtube" sans en être.
    expect(extractYouTubeId("https://notyoutube.com/watch?v=" + VID)).toBeNull();
  });

  it("chaîne vide / null / undefined / non-string", () => {
    expect(extractYouTubeId("")).toBeNull();
    expect(extractYouTubeId("   ")).toBeNull();
    expect(extractYouTubeId(null)).toBeNull();
    expect(extractYouTubeId(undefined)).toBeNull();
  });

  it("URL malformée", () => {
    expect(extractYouTubeId("pas une url")).toBeNull();
    expect(extractYouTubeId("http://")).toBeNull();
  });

  it("YouTube mais sans videoId (channel, watch sans v, racine)", () => {
    expect(extractYouTubeId("https://www.youtube.com/@RepackIt")).toBeNull();
    expect(
      extractYouTubeId("https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx"),
    ).toBeNull();
    expect(extractYouTubeId("https://www.youtube.com/watch")).toBeNull();
    expect(extractYouTubeId("https://www.youtube.com/")).toBeNull();
  });

  it("id de mauvaise longueur → null (ni trop court ni trop long)", () => {
    expect(extractYouTubeId("https://youtu.be/abc")).toBeNull(); // 3 car.
    expect(extractYouTubeId("https://youtu.be/abcdefghijklmnop")).toBeNull(); // 16 car.
    expect(extractYouTubeId("https://www.youtube.com/watch?v=short")).toBeNull();
  });
});

describe("chunk", () => {
  it("découpe par lots de 50 (respect quota)", () => {
    const ids = Array.from({ length: 125 }, (_, i) => `id${i}`);
    const batches = chunk(ids, 50);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(50);
    expect(batches[1]).toHaveLength(50);
    expect(batches[2]).toHaveLength(25);
    // Aucune perte, ordre préservé.
    expect(batches.flat()).toEqual(ids);
  });

  it("liste vide → []", () => {
    expect(chunk([], 50)).toEqual([]);
  });

  it("liste plus petite que le lot → un seul lot", () => {
    expect(chunk([1, 2, 3], 50)).toEqual([[1, 2, 3]]);
  });

  it("exactement un multiple → pas de lot vide en trop", () => {
    const ids = Array.from({ length: 100 }, (_, i) => i);
    expect(chunk(ids, 50)).toHaveLength(2);
  });

  it("taille invalide → throw", () => {
    expect(() => chunk([1, 2], 0)).toThrow();
    expect(() => chunk([1, 2], -5)).toThrow();
    expect(() => chunk([1, 2], 1.5)).toThrow();
  });
});

describe("parseVideoStats", () => {
  it("parse viewCount + likeCount + commentCount + snippet.title par vidéo", () => {
    const res = {
      items: [
        {
          id: VID,
          snippet: { title: "Mon titre YouTube" },
          statistics: { viewCount: "12345", likeCount: "67", commentCount: "12" },
        },
        { id: VID2, statistics: { viewCount: "8", likeCount: "0" } }, // sans snippet ni commentCount
      ],
    };
    const { stats, unavailable } = parseVideoStats(res, [VID, VID2]);
    expect(stats[VID]).toEqual({
      views: 12345,
      likes: 67,
      comments: 12,
      title: "Mon titre YouTube",
    });
    expect(stats[VID2]).toEqual({
      views: 8,
      likes: 0,
      comments: null,
      title: null,
    });
    expect(unavailable).toEqual([]);
  });

  it("likeCount masqué (absent) → likes null, views OK, title null sans snippet", () => {
    const res = { items: [{ id: VID, statistics: { viewCount: "500" } }] };
    expect(parseVideoStats(res, [VID]).stats[VID]).toEqual({
      views: 500,
      likes: null,
      comments: null,
      title: null,
    });
  });

  it("vidéo supprimée/privée (absente des items) → unavailable, pas de crash", () => {
    const res = {
      items: [{ id: VID, statistics: { viewCount: "10", likeCount: "1" } }],
    };
    const { stats, unavailable } = parseVideoStats(res, [VID, VID2]);
    expect(stats[VID]).toBeDefined();
    expect(stats[VID2]).toBeUndefined();
    expect(unavailable).toEqual([VID2]);
  });

  it("items vide → tout unavailable", () => {
    expect(parseVideoStats({ items: [] }, [VID, VID2]).unavailable).toEqual([
      VID,
      VID2,
    ]);
  });

  it("réponse inattendue (pas d'items, null, mauvais type) → pas de crash", () => {
    expect(parseVideoStats(null, [VID]).unavailable).toEqual([VID]);
    expect(parseVideoStats({}, [VID]).unavailable).toEqual([VID]);
    expect(parseVideoStats({ items: "nope" }, [VID]).unavailable).toEqual([VID]);
    expect(parseVideoStats("garbage", [VID]).stats).toEqual({});
  });

  it("viewCount non numérique → vidéo ignorée (unavailable)", () => {
    const res = { items: [{ id: VID, statistics: { viewCount: "N/A" } }] };
    const { stats, unavailable } = parseVideoStats(res, [VID]);
    expect(stats[VID]).toBeUndefined();
    expect(unavailable).toEqual([VID]);
  });

  it("item sans statistics → ignoré", () => {
    const res = { items: [{ id: VID }] };
    expect(parseVideoStats(res, [VID]).unavailable).toEqual([VID]);
  });
});
