import { describe, it, expect } from "vitest";
import {
  parseTikTokPublicPage,
  fetchTikTokPublicStats,
  refusalLabel,
  SELF_SEE_STATUS_CODE,
} from "../convex/tiktokPublicPage";

/**
 * Fixtures calquées sur des pages RÉELLES relevées le 2026-08-31 sur des
 * publications Snytch (structure, types mélangés et statusMsg recopiés tels
 * quels — `playCount` nombre, `collectCount` chaîne).
 */
function page(detail: unknown, extra = ""): string {
  return (
    `<!DOCTYPE html><html><head><title>TikTok</title></head><body>${extra}` +
    `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">` +
    JSON.stringify({ __DEFAULT_SCOPE__: { "webapp.video-detail": detail } }) +
    `</script></body></html>`
  );
}

/** @marine.bn07 — le post à 39 000 vues que l'app affichait « 0 vue ». */
const SERVI = page({
  itemInfo: {
    itemStruct: {
      id: "7675779059342642465",
      desc: "Heureusement que le site Snytch.co existe pour les filles comme nous. ",
      author: { uniqueId: "marine.bn07" },
      stats: {
        diggCount: 1084,
        shareCount: 32,
        commentCount: 6,
        playCount: 39000,
        collectCount: "108",
      },
    },
  },
  shareMeta: { title: "…" },
  statusCode: 0,
  statusMsg: "",
});

/** @kellyleydie — « visible par moi uniquement » : pas d'itemStruct du tout. */
const REFUSE = page({
  statusCode: 10204,
  statusMsg: "item_privacy_authorization&status_self_see",
});

describe("parseTikTokPublicPage — le post est servi", () => {
  it("rend les compteurs du post DEMANDÉ", () => {
    const r = parseTikTokPublicPage(SERVI, "7675779059342642465");
    expect(r.kind).toBe("stats");
    if (r.kind !== "stats") return;
    expect(r.stats).toEqual({
      views: 39_000,
      likes: 1_084,
      comments: 6,
      // `collectCount` arrive en CHAÎNE — les saves, qu'Apify ne donne pas ici.
      saves: 108,
      shares: 32,
      title:
        "Heureusement que le site Snytch.co existe pour les filles comme nous.",
      authorHandle: "marine.bn07",
    });
  });

  it("REFUSE de rendre les compteurs d'un autre post (vidéos recommandées)", () => {
    // La page porte aussi des recommandations : lire « le premier playCount
    // venu » rendrait les chiffres de quelqu'un d'autre.
    const r = parseTikTokPublicPage(SERVI, "7679929392667135264");
    expect(r.kind).toBe("unreadable");
    if (r.kind !== "unreadable") return;
    expect(r.reason).toContain("7675779059342642465");
    expect(r.reason).toContain("7679929392667135264");
  });

  it("légende vide → title null, jamais la chaîne vide", () => {
    const html = page({
      itemInfo: {
        itemStruct: {
          id: "7679420549268835616",
          desc: "   ",
          author: { uniqueId: "kellyleydie" },
          stats: { playCount: 1265, diggCount: 20, commentCount: 0, collectCount: "1", shareCount: 0 },
        },
      },
      statusCode: 0,
      statusMsg: "",
    });
    const r = parseTikTokPublicPage(html, "7679420549268835616");
    expect(r.kind).toBe("stats");
    if (r.kind !== "stats") return;
    expect(r.stats.title).toBeNull();
    // PRÉSENCE : le reste est bien lu, l'absence de légende n'emporte pas tout.
    expect(r.stats.views).toBe(1_265);
    expect(r.stats.likes).toBe(20);
  });
});

describe("parseTikTokPublicPage — TikTok refuse", () => {
  it("« visible par son autrice uniquement » est un FAIT, pas une absence", () => {
    const r = parseTikTokPublicPage(REFUSE, "7670619092625231137");
    expect(r.kind).toBe("refused");
    if (r.kind !== "refused") return;
    expect(r.statusCode).toBe(SELF_SEE_STATUS_CODE);
    expect(r.statusMsg).toBe("item_privacy_authorization&status_self_see");
    expect(refusalLabel(r.statusCode, r.statusMsg)).toBe(
      "visible par son autrice uniquement",
    );
  });

  it("un refus n'est JAMAIS rendu comme des compteurs à zéro", () => {
    const r = parseTikTokPublicPage(REFUSE, "7670619092625231137");
    expect(r.kind).not.toBe("stats");
  });
});

describe("parseTikTokPublicPage — page illisible", () => {
  it("balise absente", () => {
    const r = parseTikTokPublicPage("<html><body>rien</body></html>", "1");
    expect(r).toEqual({ kind: "unreadable", reason: "balise de réhydratation absente" });
  });

  it("JSON cassé", () => {
    const html =
      '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">{oops</script>';
    expect(parseTikTokPublicPage(html, "1").kind).toBe("unreadable");
  });

  it("payload sans webapp.video-detail (page de profil, redirection)", () => {
    const html =
      '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">' +
      JSON.stringify({ __DEFAULT_SCOPE__: { "webapp.app-context": {} } }) +
      "</script>";
    expect(parseTikTokPublicPage(html, "1")).toEqual({
      kind: "unreadable",
      reason: "webapp.video-detail absent",
    });
  });

  it("servi mais sans playCount → illisible, pas 0 vue", () => {
    const html = page({
      itemInfo: { itemStruct: { id: "42", desc: "x", author: { uniqueId: "a" }, stats: {} } },
      statusCode: 0,
      statusMsg: "",
    });
    const r = parseTikTokPublicPage(html, "42");
    expect(r).toEqual({ kind: "unreadable", reason: "playCount absent ou illisible" });
  });

  it("un playCount NÉGATIF est une absence, pas un compteur", () => {
    // Même règle que le relevé Apify (cf toCount) : -1 = code d'absence.
    const html = page({
      itemInfo: { itemStruct: { id: "42", desc: "x", author: { uniqueId: "a" }, stats: { playCount: -1 } } },
      statusCode: 0,
      statusMsg: "",
    });
    expect(parseTikTokPublicPage(html, "42").kind).toBe("unreadable");
  });

  it("s'arrête au </script> de SA balise, pas au dernier de la page", () => {
    // La vraie page porte des <script> APRÈS le payload. Une capture gourmande
    // avalerait jusqu'au dernier et casserait le JSON — d'où le `*?`.
    // (Un <script> placé AVANT n'exerce PAS la gourmandise : ce test-là passait
    // même avec une regex gourmande.)
    const avecSuite = SERVI.replace(
      "</body>",
      '<script>window.__later = 1;</script></body>',
    );
    const r = parseTikTokPublicPage(avecSuite, "7675779059342642465");
    expect(r.kind).toBe("stats");
    if (r.kind !== "stats") return;
    expect(r.stats.views).toBe(39_000);
  });
});

describe("fetchTikTokPublicStats — la couche réseau", () => {
  const ok = (body: string): typeof fetch =>
    (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;

  it("nettoie l'URL de ses paramètres de partage avant l'appel", async () => {
    const vues: string[] = [];
    const spy = (async (u: string) => {
      vues.push(u);
      return new Response(SERVI, { status: 200 });
    }) as unknown as typeof fetch;
    await fetchTikTokPublicStats(
      "https://www.tiktok.com/@marine.bn07/video/7675779059342642465?_r=1&_t=ZN-991A57z8tYE",
      "7675779059342642465",
      spy,
    );
    expect(vues).toEqual([
      "https://www.tiktok.com/@marine.bn07/video/7675779059342642465",
    ]);
  });

  it("rend les compteurs quand la page répond", async () => {
    const r = await fetchTikTokPublicStats(
      "https://www.tiktok.com/@marine.bn07/video/7675779059342642465",
      "7675779059342642465",
      ok(SERVI),
    );
    expect(r.kind).toBe("stats");
    if (r.kind !== "stats") return;
    expect(r.stats.views).toBe(39_000);
  });

  it("HTTP non-200 → illisible, et surtout jamais 0 vue", async () => {
    const ko = (async () => new Response("nope", { status: 429 })) as unknown as typeof fetch;
    expect(await fetchTikTokPublicStats("https://www.tiktok.com/@a/video/1", "1", ko)).toEqual({
      kind: "unreadable",
      reason: "HTTP 429",
    });
  });

  it("panne réseau : aucune exception ne sort, le relevé des autres continue", async () => {
    const boom = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const r = await fetchTikTokPublicStats("https://www.tiktok.com/@a/video/1", "1", boom);
    expect(r.kind).toBe("unreadable");
    if (r.kind !== "unreadable") return;
    expect(r.reason).toContain("ECONNRESET");
  });
});
