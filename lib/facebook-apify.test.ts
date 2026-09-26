import { describe, it, expect } from "vitest";
import {
  DEFAULT_FACEBOOK_NIGHTLY_BUDGET,
  FACEBOOK_URLS_PER_RUN,
  facebookMatchKey,
  facebookNightlyBudget,
  facebookVideoId,
  fetchFacebookViews,
  parseFacebookPosts,
  planFacebookBudget,
} from "../convex/facebookApify";

/**
 * Items de la forme du dataset de `apify/facebook-posts-scraper` (schéma du
 * build du 2026-09-25) : `postId` DIFFÉRENT de l'id du Reel dans son URL,
 * `likes` = total des réactions, `timestamp` en secondes, `inputUrl` = l'URL
 * envoyée telle quelle.
 */
const REEL_URL = "https://m.facebook.com/reel/1284539976120931/?mibextid=wwXIfr";
const PARTAGE_URL = "https://www.facebook.com/share/r/1AbCdEfGh2/?mibextid=wwXIfr";

const itemReel = {
  facebookUrl: "https://www.facebook.com/kelly.snytch",
  postId: "1441693187314472",
  url: "https://www.facebook.com/reel/1284539976120931/",
  inputUrl: REEL_URL,
  time: "2026-09-21T18:04:12.000Z",
  timestamp: 1_789_927_452,
  viewsCount: 18_342,
  videoPostViewCount: 9_120,
  likes: 612,
  comments: 41,
  shares: 17,
  isVideo: true,
  text: "  Le site qui m'a changé la vie 😭 snytch.co  ",
  user: { id: "100044214140223", name: "Kelly Snytch" },
};

/** Le lien de partage : Facebook rend l'URL canonique, `inputUrl` porte le nôtre. */
const itemPartage = {
  ...itemReel,
  postId: "1441693187399999",
  url: "https://www.facebook.com/reel/1284539976777777/",
  inputUrl: PARTAGE_URL,
  viewsCount: 2_405,
  likes: 88,
};

const cibles = [
  { key: facebookMatchKey(REEL_URL)!, url: REEL_URL },
  { key: facebookMatchKey(PARTAGE_URL)!, url: PARTAGE_URL },
];

describe("facebookMatchKey — une clé par post, quelle que soit la forme collée", () => {
  it("mobile, www, barre finale et paramètres de partage désignent le même Reel", () => {
    expect(facebookMatchKey(REEL_URL)).toBe("facebook.com/reel/1284539976120931");
    expect(facebookMatchKey("https://www.facebook.com/reel/1284539976120931")).toBe(
      "facebook.com/reel/1284539976120931",
    );
  });
  it("garde `?v=` quand c'est lui qui désigne la vidéo", () => {
    expect(facebookMatchKey("https://www.facebook.com/watch/?v=1284539976120931&ref=sharing")).toBe(
      "facebook.com/watch?v=1284539976120931",
    );
  });
  it("lien de partage et fb.watch : le chemin est la clé", () => {
    expect(facebookMatchKey(PARTAGE_URL)).toBe("facebook.com/share/r/1abcdefgh2");
    expect(facebookMatchKey("https://fb.watch/uXyZ12aBcD/")).toBe("fb.watch/uxyz12abcd");
  });
  it("hors Facebook, ou sans chemin → null", () => {
    expect(facebookMatchKey("https://facebook.com.evil.example/reel/1")).toBeNull();
    expect(facebookMatchKey("https://www.instagram.com/reel/DczkWNIt-s5/")).toBeNull();
    expect(facebookMatchKey("https://www.facebook.com/")).toBeNull();
  });
});

describe("facebookVideoId", () => {
  it("lit l'id numérique d'un Reel, d'une vidéo de Page et d'un ?v=", () => {
    expect(facebookVideoId(REEL_URL)).toBe("1284539976120931");
    expect(facebookVideoId("https://www.facebook.com/snytch.fr/videos/1284539976120931/")).toBe(
      "1284539976120931",
    );
    expect(facebookVideoId("https://www.facebook.com/watch/?v=1284539976120931")).toBe(
      "1284539976120931",
    );
    expect(facebookVideoId(PARTAGE_URL)).toBeNull();
  });
});

describe("parseFacebookPosts — rapprochement par l'URL envoyée, jamais par postId", () => {
  it("rapproche par `inputUrl`, lien de partage compris ; vues = viewsCount (pas les vues de 3 s)", () => {
    const r = parseFacebookPosts([itemPartage, itemReel], cibles);
    expect(r.unavailable).toEqual([]);
    expect(r.stats[cibles[0].key]).toEqual({
      views: 18_342,
      likes: 612,
      comments: 41,
      shares: 17,
      title: "Le site qui m'a changé la vie 😭 snytch.co",
      publishedAt: 1_789_927_452_000,
    });
    // Le lien de partage reçoit SES compteurs, pas ceux de l'autre Reel.
    expect(r.stats[cibles[1].key]).toMatchObject({ views: 2_405, likes: 88 });
  });

  it("sans `inputUrl` exploitable : repli sur l'id de vidéo de `url`", () => {
    const { inputUrl: _omis, ...sansEntree } = itemReel;
    const r = parseFacebookPosts([sansEntree], [cibles[0]]);
    expect(r.stats[cibles[0].key]?.views).toBe(18_342);
  });

  it("un post sans compteur de vues (photo) n'est PAS inscrit à 0 : il est indisponible", () => {
    const photo = { ...itemReel, viewsCount: null, videoPostViewCount: null, isVideo: false };
    const r = parseFacebookPosts([photo], [cibles[0]]);
    expect(r.stats).toEqual({});
    expect(r.unavailable).toEqual([cibles[0].key]);
  });

  it("un item qu'on n'a pas demandé est ignoré", () => {
    const autre = {
      ...itemReel,
      url: "https://www.facebook.com/reel/9999999999999/",
      inputUrl: "https://www.facebook.com/reel/9999999999999/",
    };
    const r = parseFacebookPosts([autre], [cibles[0]]);
    expect(r.stats).toEqual({});
  });
});

function fetchEnregistre(reponses: (() => Response)[]) {
  const appels: { url: string; body: { startUrls: { url: string }[] } }[] = [];
  let i = 0;
  const impl = (async (u: string, init: RequestInit) => {
    appels.push({ url: u, body: JSON.parse(String(init.body)) });
    const f = reponses[Math.min(i, reponses.length - 1)];
    i += 1;
    return f();
  }) as unknown as typeof fetch;
  return { impl, appels };
}

describe("fetchFacebookViews — le coût est borné à la source", () => {
  it("chaque run porte maxItems et maxTotalChargeUsd à la taille du lot", async () => {
    const { impl, appels } = fetchEnregistre([
      () => new Response(JSON.stringify([itemReel, itemPartage]), { status: 200 }),
    ]);
    const r = await fetchFacebookViews(cibles, "apify_api_test", impl);
    expect(r.runs).toBe(1);
    expect(appels[0].url).toContain("maxItems=2");
    expect(appels[0].url).toContain("maxTotalChargeUsd=0.016");
    expect(appels[0].body.startUrls).toEqual([{ url: REEL_URL }, { url: PARTAGE_URL }]);
    expect(Object.keys(r.stats)).toHaveLength(2);
  });

  it(`découpe en lots de ${FACEBOOK_URLS_PER_RUN} et dédoublonne les posts partagés`, async () => {
    const urls = Array.from(
      { length: 30 },
      (_, i) => `https://www.facebook.com/reel/12845399761${String(20_000 + i)}/`,
    );
    const t = [...urls, urls[0]].map((url) => ({ key: facebookMatchKey(url)!, url }));
    const { impl, appels } = fetchEnregistre([() => new Response("[]", { status: 200 })]);
    const r = await fetchFacebookViews(t, "apify_api_test", impl);
    expect(r.runs).toBe(2);
    expect(appels.map((a) => a.body.startUrls.length)).toEqual([25, 5]);
    expect(r.unavailable).toHaveLength(30);
  });

  it("crédit épuisé (402) : le lot est perdu AVEC son motif, les suivants continuent", async () => {
    const { impl } = fetchEnregistre([
      () =>
        new Response(JSON.stringify({ error: { message: "Monthly usage hard limit exceeded" } }), {
          status: 402,
        }),
    ]);
    const r = await fetchFacebookViews(cibles, "apify_api_test", impl);
    expect(r.errors).toEqual([
      { status: 402, message: "Monthly usage hard limit exceeded", batchSize: 2 },
    ]);
    expect(r.unavailable).toHaveLength(2);
  });
});

describe("planFacebookBudget — le plafond fait tourner le catalogue", () => {
  const DAY = 86_400_000;
  const pub = (id: string, datePubli: number, lastSyncAt?: number) => ({ id, datePubli, lastSyncAt });

  it("jamais mesurés d'abord, puis les moins récemment mesurés", () => {
    const due = [
      pub("mesure-hier", 1_789_000_000_000, 1_789_900_000_000 - DAY),
      pub("jamais-ancien", 1_788_000_000_000),
      pub("mesure-avant-hier", 1_789_000_000_000, 1_789_900_000_000 - 2 * DAY),
      pub("jamais-recent", 1_789_500_000_000),
    ];
    const { retenus, reportes } = planFacebookBudget(due, 3);
    // À égalité (jamais mesurés), le plus récemment publié passe devant.
    expect(retenus.map((p) => p.id)).toEqual(["jamais-recent", "jamais-ancien", "mesure-avant-hier"]);
    expect(reportes.map((p) => p.id)).toEqual(["mesure-hier"]);
  });

  it("plafond à 0 : rien n'est relevé, tout est reporté", () => {
    const { retenus, reportes } = planFacebookBudget([pub("a", 1), pub("b", 2)], 0);
    expect(retenus).toEqual([]);
    expect(reportes).toHaveLength(2);
  });
});

describe("facebookNightlyBudget", () => {
  it("lit la variable, retombe sur le défaut si elle est absente ou invalide", () => {
    expect(facebookNightlyBudget("15")).toBe(15);
    expect(facebookNightlyBudget("0")).toBe(0);
    expect(facebookNightlyBudget(undefined)).toBe(DEFAULT_FACEBOOK_NIGHTLY_BUDGET);
    expect(facebookNightlyBudget("beaucoup")).toBe(DEFAULT_FACEBOOK_NIGHTLY_BUDGET);
    expect(facebookNightlyBudget("-3")).toBe(DEFAULT_FACEBOOK_NIGHTLY_BUDGET);
  });
});
