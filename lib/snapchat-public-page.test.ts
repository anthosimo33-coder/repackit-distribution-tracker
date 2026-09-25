import { describe, it, expect } from "vitest";
import {
  fetchSnapchatProfile,
  fetchSnapchatSpotlightStats,
  isSnapchatShortlink,
  parseSnapchatProfilePage,
  parseSnapchatSpotlightPage,
  snapchatProfileUrl,
  snapchatSpotlightId,
} from "../convex/snapchatPublicPage";

/**
 * Pages recopiées d'une page RÉELLE relevée le 2026-09-25
 * (`snapchat.com/@f.drl10/spotlight/W7_…`) : compteurs en CHAÎNES, identifiants
 * emballés `{ value }`, `videoMetadata.shareCount` à « 0 » quand
 * `engagementStats.shareCount` en porte 799, et un fil qui porte D'AUTRES
 * Spotlight que celui demandé.
 */
const ID_DRL = "W7_EDlXWTBiXAEEniNoMPwAAYa2pqcm5vbmlsAaChyLxkAaChyHOWAAAAAQ";
const ID_TOKYO = "W7_EDlXWTBiXAEEniNoMPwAAYYnhjeXdhbXdpAZ_IEJF8AZ_IEEf6AAAAAw";

const vm = (uploadDateMs: string, viewCount: string, username: string) => ({
  uploadDateMs,
  viewCount,
  shareCount: "0",
  creator: { personCreator: { username, followerCount: "0" } },
});

const entree = (
  id: string,
  meta: ReturnType<typeof vm>,
  engagement: Record<string, string>,
) => ({
  story: {
    storyId: { value: id },
    snapList: [{ snapIndex: 0, snapId: { value: id } }],
  },
  metadata: { videoMetadata: meta, engagementStats: engagement },
});

const DRL = entree(ID_DRL, vm("1789420663702", "339002", "f.drl10"), {
  viewCount: "339002",
  shareCount: "799",
  commentCount: "468",
  boostCount: "46735",
  recommendCount: "3986",
});
const TOKYO = entree(ID_TOKYO, vm("1785767938042", "126384", "tokyoo2005"), {
  viewCount: "126384",
  shareCount: "203",
  commentCount: "73",
  boostCount: "9080",
  recommendCount: "189",
});

function page(pageProps: unknown): string {
  return (
    `<!DOCTYPE html><html><head><title>Snapchat</title></head><body>` +
    `<script id="__NEXT_DATA__" type="application/json">` +
    JSON.stringify({ props: { pageProps }, page: "/@[username]/spotlight/[snapID]" }) +
    `</script></body></html>`
  );
}

/** La page du Spotlight de @f.drl10 : il est EN TÊTE du fil. */
const PAGE_DRL = page({
  videoMetadata: vm("1789420663702", "339002", "f.drl10"),
  spotlightFeed: { spotlightStories: [DRL, TOKYO] },
  restricted: false,
});

describe("snapchatSpotlightId — l'identifiant dans l'URL", () => {
  it.each([
    [`https://www.snapchat.com/spotlight/${ID_DRL}`, ID_DRL],
    [`https://www.snapchat.com/@f.drl10/spotlight/${ID_DRL}?share_id=MTIz&locale=fr-FR`, ID_DRL],
    [`snapchat.com/spotlight/${ID_DRL}/`, ID_DRL],
    ["https://www.snapchat.com/t/AbCdEf12", null],
    ["https://www.snapchat.com/add/f.drl10", null],
    ["https://www.snapchat.com/@f.drl10", null],
    [`https://snapchat.com.evil.example/spotlight/${ID_DRL}`, null],
    ["", null],
  ])("%s → %s", (url, attendu) => {
    expect(snapchatSpotlightId(url)).toBe(attendu);
  });
});

describe("isSnapchatShortlink", () => {
  it("reconnaît le lien court de partage, rien d'autre", () => {
    expect(isSnapchatShortlink("https://www.snapchat.com/t/AbCdEf12")).toBe(true);
    expect(isSnapchatShortlink("https://snapchat.com/t/AbCdEf12/")).toBe(true);
    expect(isSnapchatShortlink(`https://www.snapchat.com/spotlight/${ID_DRL}`)).toBe(false);
    expect(isSnapchatShortlink("https://www.tiktok.com/t/ZP8cDXdtT/")).toBe(false);
  });
});

describe("parseSnapchatSpotlightPage — le Spotlight demandé, jamais un autre", () => {
  it("lit les compteurs d'engagement : likes = boostCount, partages de engagementStats", () => {
    const r = parseSnapchatSpotlightPage(PAGE_DRL, ID_DRL);
    expect(r).toEqual({
      kind: "stats",
      stats: {
        views: 339_002,
        likes: 46_735,
        comments: 468,
        shares: 799,
        uploadedAt: 1_789_420_663_702,
        creatorHandle: "f.drl10",
      },
    });
  });

  it("retrouve le Spotlight par son id quand il n'est PAS en tête du fil", () => {
    // Même page, fil dans l'autre ordre : lire « le premier » rendrait 339 002.
    const inverse = page({
      videoMetadata: vm("1785767938042", "126384", "tokyoo2005"),
      spotlightFeed: { spotlightStories: [DRL, TOKYO] },
    });
    const r = parseSnapchatSpotlightPage(inverse, ID_TOKYO);
    expect(r.kind).toBe("stats");
    if (r.kind !== "stats") return;
    expect(r.stats.views).toBe(126_384);
    expect(r.stats.likes).toBe(9_080);
    expect(r.stats.creatorHandle).toBe("tokyoo2005");
  });

  it("un id absent de la page → illisible, jamais les compteurs d'un voisin", () => {
    const r = parseSnapchatSpotlightPage(PAGE_DRL, "W7_EDlXWTBiXAEEniNoMPwAAYZZZZZZZZZZZZZZAAAAAQ");
    expect(r.kind).toBe("unreadable");
  });

  it("lien court (id inconnu) : la vidéo principale, appariée au fil par date ET autrice", () => {
    const r = parseSnapchatSpotlightPage(PAGE_DRL, null);
    expect(r.kind).toBe("stats");
    if (r.kind !== "stats") return;
    expect(r.stats.views).toBe(339_002);
    expect(r.stats.likes).toBe(46_735);
  });

  it("lien court sans entrée correspondante : les vues seules, likes inconnus (pas 0)", () => {
    const seule = page({
      videoMetadata: vm("1790000000000", "5120", "kelly.snytch"),
      spotlightFeed: { spotlightStories: [DRL, TOKYO] },
    });
    const r = parseSnapchatSpotlightPage(seule, null);
    expect(r).toMatchObject({ kind: "stats", stats: { views: 5_120, likes: null, comments: null } });
  });

  it("sans payload __NEXT_DATA__ → illisible (c'est ce qui alimente le coupe-circuit)", () => {
    expect(parseSnapchatSpotlightPage("<html><body>captcha</body></html>", ID_DRL)).toMatchObject({
      kind: "unreadable",
    });
  });
});

describe("parseSnapchatProfilePage", () => {
  it("abonnés d'un profil public (chaîne → nombre) et photo", () => {
    const r = parseSnapchatProfilePage(
      page({
        userProfile: {
          publicProfileInfo: {
            username: "f.drl10",
            subscriberCount: "146900",
            profilePictureUrl: "https://cf-st.sc-cdn.net/aps/bolt/aHR0cHM6Ly9jZi1zdC5zYy1jZG4ubmV0.png",
          },
        },
      }),
    );
    expect(r).toEqual({
      kind: "profile",
      profile: {
        subscribers: 146_900,
        avatarUrl: "https://cf-st.sc-cdn.net/aps/bolt/aHR0cHM6Ly9jZi1zdC5zYy1jZG4ubmV0.png",
      },
    });
  });

  it("profil privé (pas de publicProfileInfo) : abonnés INCONNUS, pas zéro", () => {
    const r = parseSnapchatProfilePage(page({ userProfile: { userInfo: { username: "x" } } }));
    expect(r).toEqual({ kind: "profile", profile: { subscribers: null, avatarUrl: null } });
  });
});

describe("snapchatProfileUrl", () => {
  it("l'URL collée prime, sans ses paramètres de partage", () => {
    expect(
      snapchatProfileUrl("@Kelly", "https://www.snapchat.com/add/kelly.snytch?share_id=MTIz&locale=fr-FR"),
    ).toBe("https://www.snapchat.com/add/kelly.snytch");
    expect(snapchatProfileUrl("@Kelly", "https://www.snapchat.com/@kelly.snytch")).toBe(
      "https://www.snapchat.com/add/kelly.snytch",
    );
  });
  it("sans URL exploitable, le handle ; sinon rien", () => {
    expect(snapchatProfileUrl("@kelly.snytch", null)).toBe("https://www.snapchat.com/add/kelly.snytch");
    expect(snapchatProfileUrl("@kelly.snytch", "https://www.instagram.com/kelly/")).toBe(
      "https://www.snapchat.com/add/kelly.snytch",
    );
    expect(snapchatProfileUrl("Kelly Martin", null)).toBeNull();
  });
});

/** Réponse simulée qui porte son URL finale (après redirection). */
function reponse(body: string, status = 200, url = ""): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    text: async () => body,
  } as unknown as Response;
}

describe("fetchSnapchatSpotlightStats", () => {
  it("demande l'URL SANS ses paramètres de partage", async () => {
    const vus: string[] = [];
    const impl = (async (u: string) => {
      vus.push(u);
      return reponse(PAGE_DRL);
    }) as unknown as typeof fetch;
    const r = await fetchSnapchatSpotlightStats(
      `https://www.snapchat.com/@f.drl10/spotlight/${ID_DRL}?share_id=MTIz&locale=fr-FR`,
      ID_DRL,
      impl,
    );
    expect(r.kind).toBe("stats");
    expect(vus).toEqual([`https://www.snapchat.com/@f.drl10/spotlight/${ID_DRL}`]);
  });

  it("404 → « introuvable », distinct d'une page illisible", async () => {
    const r = await fetchSnapchatSpotlightStats(
      `https://www.snapchat.com/spotlight/${ID_DRL}`,
      ID_DRL,
      (async () => reponse("", 404)) as unknown as typeof fetch,
    );
    expect(r).toMatchObject({ kind: "gone" });
  });

  it("429 et coupure réseau → illisibles, avec leur motif", async () => {
    const r429 = await fetchSnapchatSpotlightStats(
      `https://www.snapchat.com/spotlight/${ID_DRL}`,
      ID_DRL,
      (async () => reponse("Too Many Requests", 429)) as unknown as typeof fetch,
    );
    expect(r429).toEqual({ kind: "unreadable", reason: "HTTP 429" });
    const reseau = await fetchSnapchatSpotlightStats(
      `https://www.snapchat.com/spotlight/${ID_DRL}`,
      ID_DRL,
      (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    );
    expect(reseau.kind).toBe("unreadable");
  });

  it("lien court : l'identifiant est relu dans l'URL où il redirige", async () => {
    const r = await fetchSnapchatSpotlightStats(
      "https://www.snapchat.com/t/AbCdEf12",
      null,
      (async () =>
        reponse(PAGE_DRL, 200, `https://www.snapchat.com/@tokyoo2005/spotlight/${ID_TOKYO}`)) as unknown as typeof fetch,
    );
    // L'URL finale désigne TOKYO : ce sont SES compteurs, pas ceux de la vidéo principale.
    expect(r).toMatchObject({ kind: "stats", stats: { views: 126_384, likes: 9_080 } });
  });

  it("n'appelle JAMAIS un autre hôte que snapchat.com", async () => {
    let appels = 0;
    const r = await fetchSnapchatSpotlightStats(
      `https://snapchat.com.evil.example/spotlight/${ID_DRL}`,
      ID_DRL,
      (async () => {
        appels += 1;
        return reponse(PAGE_DRL);
      }) as unknown as typeof fetch,
    );
    expect(appels).toBe(0);
    expect(r.kind).toBe("unreadable");
  });
});

describe("fetchSnapchatProfile", () => {
  it("404 → profil introuvable, pas un blocage", async () => {
    const r = await fetchSnapchatProfile(
      "https://www.snapchat.com/add/zzzz_no_such_user_zzzz_123",
      (async () => reponse("", 404)) as unknown as typeof fetch,
    );
    expect(r).toMatchObject({ kind: "gone" });
  });
});
