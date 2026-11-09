import { describe, it, expect } from "vitest";
import {
  IG_REELS_MAX_PAGES,
  fetchFacebookViewsSc,
  fetchInstagramViewsSc,
  instagramShortcodeTime,
  parseFacebookPost,
  parseIgPost,
  parseIgReelItem,
  scFailureReason,
} from "../convex/scrapeCreatorsViews";

/**
 * Formes relevées sur de vrais appels ScrapeCreators le 09/11/2026 (reel de
 * @cami.snytch, reel Facebook de Kelly Dgtl), réduites aux champs lus.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const IG_EPOCH_MS = 1_314_220_021_721;
const H = 3_600_000;
const NOW = Date.UTC(2026, 10, 9, 12);

/** Shortcode d'un média mis en ligne à `ms` (l'inverse de ce que lit le module). */
function codeAt(ms: number, seq = 1): string {
  let id = (BigInt(ms - IG_EPOCH_MS) << BigInt(23)) + BigInt(seq);
  let out = "";
  while (id > BigInt(0)) {
    out = ALPHABET[Number(id % BigInt(64))] + out;
    id /= BigInt(64);
  }
  return out;
}

const reel = (code: string, takenAtMs: number, views: number, username = "cami.snytch") => ({
  media: {
    code,
    taken_at: Math.floor(takenAtMs / 1000),
    play_count: views,
    like_count: 15,
    comment_count: 2,
    caption: { text: "al final todos son iguales 💔" },
    user: { username, id: "28466498355", pk: 28466498355 },
  },
});

const post = (code: string, views: number | null, username: string, id: string) => ({
  success: true,
  data: {
    xdt_shortcode_media: {
      shortcode: code,
      ...(views !== null ? { video_play_count: views, is_video: true } : { is_video: false }),
      edge_media_preview_like: { count: 6 },
      edge_media_to_parent_comment: { count: 0 },
      edge_media_to_caption: { edges: [{ node: { text: "légende du post" } }] },
      owner: { id, username },
    },
  },
});

type Route = (url: URL) => { status: number; body: unknown };

/** Faux ScrapeCreators : journalise chaque appel (chemin + paramètres + en-tête). */
function fakeSc(route: Route) {
  const appels: { path: string; params: Record<string, string>; key: string | null; href: string }[] = [];
  const impl = (async (u: string, init?: { headers?: Record<string, string> }) => {
    const url = new URL(u);
    appels.push({
      path: url.pathname,
      params: Object.fromEntries(url.searchParams),
      key: init?.headers?.["x-api-key"] ?? null,
      href: u,
    });
    const r = route(url);
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { impl, appels };
}

const urlOf = (code: string) => `https://www.instagram.com/reel/${code}/?igsh=abc`;
const cible = (code: string, compte = "@cami.snytch") => ({ key: code, url: urlOf(code), compte });

describe("instagramShortcodeTime — la date est dans le lien", () => {
  it("lit l'instant d'un vrai shortcode (reel du 09/11/2026, 22 s avant son taken_at)", () => {
    const t = instagramShortcodeTime("DffxsW5KXEb");
    expect(t).not.toBeNull();
    expect(Math.abs((t as number) - 1_794_175_138_000)).toBeLessThan(60_000);
  });

  it("refuse ce qui n'est pas un shortcode décodable", () => {
    expect(instagramShortcodeTime("")).toBeNull();
    expect(instagramShortcodeTime("abc")).toBeNull();
    // Shortcode long d'un compte privé : pas de date lisible.
    expect(instagramShortcodeTime("DffxsW5KXEbQ3Zr8sJkLmNoPqRsTuVwXyZ")).toBeNull();
    expect(instagramShortcodeTime("Dffx sW5KX")).toBeNull();
  });
});

describe("lecture des réponses", () => {
  it("un reel de la liste du compte : vues, likes, commentaires, auteur, légende", () => {
    expect(parseIgReelItem(reel("DffxsW5KXEb", NOW, 1_867))).toEqual({
      key: "DffxsW5KXEb",
      publishedAt: Math.floor(NOW / 1000) * 1000,
      stat: {
        views: 1_867,
        likes: 15,
        comments: 2,
        title: "al final todos son iguales 💔",
        saves: null,
        author: null,
        ownerUsername: "cami.snytch",
        ownerId: "28466498355",
      },
    });
  });

  it("une photo n'a pas de vues : non retenue, jamais « 0 vue »", () => {
    expect(parseIgPost(post("DffxL5zKmMA", null, "cami.snytch", "1"))).toBeNull();
    expect(parseIgReelItem({ media: { code: "DffxL5zKmMA", like_count: 3 } })).toBeNull();
  });

  it("un compteur négatif (likes masqués) est une absence, pas un compte", () => {
    const r = parseIgReelItem({ media: { ...reel("DffxsW5KXEb", NOW, 10).media, like_count: -1 } });
    expect(r?.stat.likes).toBeNull();
  });

  it("une légende longue est coupée sans casser un emoji", () => {
    const long = `${"a".repeat(499)}💔💔`;
    const r = parseIgReelItem({ media: { ...reel("DffxsW5KXEb", NOW, 10).media, caption: { text: long } } });
    expect(r?.stat.title).toBe(`${"a".repeat(499)}💔`);
  });

  it("un post Facebook : vues, réactions, partages, date de mise en ligne", () => {
    expect(
      parseFacebookPost({
        success: true,
        view_count: 20,
        like_count: 1,
        comment_count: 0,
        share_count: 0,
        description: null,
        creation_time: "2026-10-11T19:21:24.000Z",
      }),
    ).toEqual({
      views: 20,
      likes: 1,
      comments: 0,
      shares: 0,
      title: null,
      publishedAt: Date.parse("2026-10-11T19:21:24.000Z"),
    });
    expect(parseFacebookPost({ success: true, like_count: 4 })).toBeNull();
  });
});

describe("fetchInstagramViewsSc — par compte, puis par lien", () => {
  const recent = [codeAt(NOW - 2 * H, 1), codeAt(NOW - 5 * H, 2), codeAt(NOW - 30 * H, 3)];

  it("trois posts d'un compte sur sa première page : UN crédit, rapprochés par shortcode", async () => {
    const { impl, appels } = fakeSc(() => ({
      status: 200,
      body: {
        success: true,
        items: [
          reel(codeAt(NOW - 1 * H, 9), NOW - 1 * H, 50),
          reel(recent[0], NOW - 2 * H, 1_867),
          reel(recent[1], NOW - 5 * H, 640),
          reel(recent[2], NOW - 30 * H, 12_000),
        ],
        paging_info: { more_available: true, max_id: "QVFE" },
      },
    }));

    const r = await fetchInstagramViewsSc(recent.map((c) => cible(c)), "sc_test_key", impl);

    expect(appels.map((a) => [a.path, a.params.handle])).toEqual([["/v1/instagram/user/reels", "cami.snytch"]]);
    expect(r.calls).toBe(1);
    expect(Object.fromEntries(Object.entries(r.stats).map(([k, s]) => [k, s.views]))).toEqual({
      [recent[0]]: 1_867,
      [recent[1]]: 640,
      [recent[2]]: 12_000,
    });
    expect(r.stats[recent[0]].ownerUsername).toBe("cami.snytch");
    expect(r.unavailable).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  it("descend à la page suivante tant que le post cherché est plus vieux que la page", async () => {
    const vieux = codeAt(NOW - 20 * 24 * H, 4);
    const { impl, appels } = fakeSc((url) =>
      url.searchParams.get("max_id") === null
        ? {
            status: 200,
            body: {
              success: true,
              items: [reel(codeAt(NOW - 24 * H, 5), NOW - 24 * H, 10), reel(codeAt(NOW - 5 * 24 * H, 6), NOW - 5 * 24 * H, 10)],
              paging_info: { more_available: true, max_id: "PAGE2" },
            },
          }
        : {
            status: 200,
            body: {
              success: true,
              items: [reel(vieux, NOW - 20 * 24 * H, 33_000)],
              paging_info: { more_available: true, max_id: "PAGE3" },
            },
          },
    );

    const r = await fetchInstagramViewsSc([cible(vieux)], "sc_test_key", impl);

    expect(appels.map((a) => a.params.max_id ?? null)).toEqual([null, "PAGE2"]);
    expect(r.stats[vieux]?.views).toBe(33_000);
  });

  it("une page plus vieille que le post sans l'avoir vu : on arrête de descendre, le lien prend le relais", async () => {
    // Reel épinglé (absent de la liste) ou lien d'un autre compte.
    const absent = codeAt(NOW - 3 * H, 7);
    const { impl, appels } = fakeSc((url) =>
      url.pathname === "/v1/instagram/user/reels"
        ? {
            status: 200,
            body: {
              success: true,
              items: [reel(codeAt(NOW - 1 * H, 8), NOW - 1 * H, 10), reel(codeAt(NOW - 2 * 24 * H, 9), NOW - 2 * 24 * H, 10)],
              paging_info: { more_available: true, max_id: "PAGE2" },
            },
          }
        : { status: 200, body: post(absent, 371_878, "princiaconfort", "999") },
    );

    const r = await fetchInstagramViewsSc([cible(absent)], "sc_test_key", impl);

    expect(appels.map((a) => a.path)).toEqual(["/v1/instagram/user/reels", "/v1/instagram/post"]);
    expect(appels[1].params.url).toBe(urlOf(absent));
    // L'auteur rendu par le lien va à la garde de propriété (convex/postOwner.ts).
    expect(r.stats[absent]).toMatchObject({ views: 371_878, ownerUsername: "princiaconfort", ownerId: "999" });
    expect(r.calls).toBe(2);
  });

  it(`borné à ${IG_REELS_MAX_PAGES} pages par compte, même si la liste ne finit jamais`, async () => {
    const tresVieux = codeAt(NOW - 400 * 24 * H, 10);
    let n = 0;
    const { impl, appels } = fakeSc((url) => {
      if (url.pathname === "/v1/instagram/post") return { status: 404, body: { success: false, message: "Post not found" } };
      n += 1;
      return {
        status: 200,
        body: {
          success: true,
          items: [reel(codeAt(NOW - n * H, 20 + n), NOW - n * H, 1)],
          paging_info: { more_available: true, max_id: `P${n}` },
        },
      };
    });

    const r = await fetchInstagramViewsSc([cible(tresVieux)], "sc_test_key", impl);

    expect(appels.filter((a) => a.path === "/v1/instagram/user/reels")).toHaveLength(IG_REELS_MAX_PAGES);
    expect(r.unavailable).toEqual([tresVieux]);
  });

  it("un @ introuvable : chaque post est lu par son lien", async () => {
    const { impl, appels } = fakeSc((url) =>
      url.pathname === "/v1/instagram/user/reels"
        ? { status: 404, body: { success: false, message: "User not found" } }
        : { status: 200, body: post(url.searchParams.get("url")!.split("/")[4], 120, "cami.snytch", "28466498355") },
    );

    const r = await fetchInstagramViewsSc([cible(recent[0], "@cami snytch (FR)")], "sc_test_key", impl);

    expect(appels.map((a) => a.path)).toEqual(["/v1/instagram/user/reels", "/v1/instagram/post"]);
    expect(r.stats[recent[0]]?.views).toBe(120);
    // Le @ introuvable n'est pas une erreur du passage : le lien a répondu.
    expect(r.errors).toEqual([]);
  });

  it("crédit épuisé (HTTP 402) : plus AUCUN appel, l'erreur est rendue", async () => {
    const autre = codeAt(NOW - 4 * H, 11);
    const { impl, appels } = fakeSc(() => ({ status: 402, body: { success: false, message: "Not enough credits" } }));

    const r = await fetchInstagramViewsSc(
      [cible(recent[0]), cible(autre, "@sarah.snytch")],
      "sc_test_key",
      impl,
    );

    expect(appels).toHaveLength(1);
    expect(r.errors.map((e) => e.status)).toEqual([402]);
    expect(r.unavailable.sort()).toEqual([recent[0], autre].sort());
    expect(scFailureReason(r.errors[0])).toBe("crédit ScrapeCreators épuisé");
  });

  it("deux publications d'un même post supprimé : son lien n'est payé qu'une fois", async () => {
    const { impl, appels } = fakeSc((url) =>
      url.pathname === "/v1/instagram/user/reels"
        ? { status: 200, body: { success: true, items: [], paging_info: { more_available: false } } }
        : { status: 404, body: { success: false, message: "Post not found" } },
    );
    const r = await fetchInstagramViewsSc([cible(recent[0]), cible(recent[0])], "sc_test_key", impl);
    expect(appels.map((a) => a.path)).toEqual(["/v1/instagram/user/reels", "/v1/instagram/post"]);
    expect(r.unavailable).toEqual([recent[0]]);
  });

  it("la clé part en en-tête, jamais dans l'adresse", async () => {
    const { impl, appels } = fakeSc(() => ({
      status: 200,
      body: { success: true, items: [], paging_info: { more_available: false } },
    }));
    await fetchInstagramViewsSc([cible(recent[0])], "sc_secret_key", impl);
    expect(appels.length).toBeGreaterThan(0);
    for (const a of appels) {
      expect(a.key).toBe("sc_secret_key");
      expect(a.href).not.toContain("sc_secret_key");
    }
  });
});

describe("fetchFacebookViewsSc — un crédit par post", () => {
  it("rend ce qui a des vues, le reste en indisponible ; s'arrête au crédit épuisé", async () => {
    const { impl, appels } = fakeSc((url) => {
      const u = url.searchParams.get("url") ?? "";
      if (u.includes("photo")) return { status: 200, body: { success: true, like_count: 3 } };
      if (u.includes("vide")) return { status: 402, body: { success: false, message: "Not enough credits" } };
      return { status: 200, body: { success: true, view_count: 20, like_count: 1, comment_count: 0, share_count: 0 } };
    });

    const r = await fetchFacebookViewsSc(
      [
        { key: "reel", url: "https://www.facebook.com/reel/1284539976120931/" },
        { key: "photo", url: "https://www.facebook.com/photo/?fbid=1" },
        { key: "vide", url: "https://www.facebook.com/reel/vide/" },
        { key: "jamais", url: "https://www.facebook.com/reel/2/" },
      ],
      "sc_test_key",
      impl,
    );

    expect(r.stats.reel?.views).toBe(20);
    expect(r.unavailable).toEqual(["photo", "vide", "jamais"]);
    expect(appels).toHaveLength(3);
    expect(r.runs).toBe(3);
    expect(scFailureReason(r.errors[0])).toBe("crédit ScrapeCreators épuisé");
  });
});

describe("scFailureReason", () => {
  it("garde le statut et le message de toute autre erreur, borné", () => {
    expect(scFailureReason({ status: 500, message: "Internal error" })).toBe(
      "ScrapeCreators en erreur (500) — Internal error",
    );
    expect(scFailureReason({ status: "network", message: "x".repeat(500) }).length).toBe(200);
  });
});
