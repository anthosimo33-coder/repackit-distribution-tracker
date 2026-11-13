import { describe, expect, it } from "vitest";
import {
  fetchMarketPage,
  isProduct,
  marketAnswer,
  marketCandidateKey,
  MARKET_BREAKER,
  MARKET_JUDGE_BATCH,
  MARKET_PAUSE_MAX_MS,
  MARKET_PAUSE_MIN_MS,
  MARKET_READS_PER_RUN,
  MARKET_SCHEMA,
  marketPatterns,
  marketPauseMs,
  marketPrompt,
  marketTotals,
  pageFlux,
  parseCampaignPage,
  parseMarketSitemap,
  productKey,
  type MarketToJudge,
} from "../convex/radarMarketMath";

/**
 * Radar — apps et logiciels qui paient des créateurs, lus sur une place de marché de campagnes (13/11/2026).
 * Les pages d'essai ont la forme relevée ce jour-là sur contentrewards.com : le contenu arrive par morceaux
 * (`self.__next_f.push([1,"…"])`), la campagne est un objet « data », ses meilleurs clips un tableau « topClips ».
 */

/** Une page de campagne comme la place de marché la sert : chaque morceau est une chaîne JSON échappée. */
function page(data: Record<string, unknown> | null, topClips: unknown[] | null, extra = ""): string {
  const morceaux: string[] = ['{"queries":[{"state":{"data":["orgs"]}}]}'];
  if (data) morceaux.push(`{"dehydratedAt":1794570583536,"state":{"data":${JSON.stringify(data)}}}`);
  if (topClips) morceaux.push(`{"state":{"data":{"daily":[],"creatorCount":46,"topClips":${JSON.stringify(topClips)},"topEarners":[],"totalViews":589966}}}${extra}`);
  // Coupé au milieu, comme en vrai : la page pousse son contenu par tranches.
  const tout = morceaux.join(",");
  const moitie = Math.floor(tout.length / 2);
  const pousse = (s: string) => `<script>self.__next_f.push([1,${JSON.stringify(s)}])</script>`;
  return `<!doctype html><html><head><title>Campagne | Content Rewards</title></head><body>${pousse(tout.slice(0, moitie))}${pousse(tout.slice(moitie))}</body></html>`;
}

const OPEN_ROAD = {
  banner: "https://crusercontent.com/x.webp",
  createdAt: "2026-09-09T19:00:00.000Z",
  description: "Open Road (@openroadapp) is a drive tracker for iOS and Android, like Strava for your car. Flood TikTok and Instagram with slideshows.",
  id: "6c0cb168-82d6-45ae-9e7c-b407aa1c6616",
  launchDate: "2026-09-09T19:01:02.000Z",
  metrics: { approvedSubmissionCount: 120, budgetProgressBps: 3230, budgetSpentCents: 169_580, creatorCount: 46, paidOutCents: 150_000, totalViews: 589_966 },
  name: "Open Road Clipping | $5.25K Budget | $1.25 CPM",
  organization: { logoUrl: "$undefined", name: "Clipix", profileHandle: "clipix", verified: false },
  status: "active",
  type: "cpm",
};
const PAIEMENTS = ',"payouts":[{"maxPayoutCents":20000,"minPayoutCents":100,"payoutType":"cpm","platform":"tiktok","rateCents":125}],"primaryPayoutCents":125';
const CLIPS = [
  { platform: "tiktok", postUrl: "https://www.tiktok.com/@Reign.Mustang/video/7700000000000000001", rank: 1 },
  { platform: "instagram", postUrl: "https://www.instagram.com/reel/DfqFMFfzJZU/", rank: 2 },
  { platform: "tiktok", postUrl: "https://www.tiktok.com/@leos.m5/photo/7700000000000000002", rank: 3 },
  { platform: "tiktok", postUrl: "https://www.tiktok.com/@reign.mustang/video/7700000000000000003", rank: 4 },
  { platform: "youtube", postUrl: "https://www.youtube.com/shorts/abc", rank: 5 },
];

describe("Radar — place de marché : la liste des campagnes", () => {
  it("le plan de site donne les campagnes, chacune une fois ; les autres pages n'en sont pas", () => {
    const xml = `<?xml version="1.0"?><urlset>
      <url><loc>https://contentrewards.com</loc></url>
      <url><loc>https://contentrewards.com/c/discover/ugc</loc></url>
      <url><loc>https://contentrewards.com/c/campaigns/6c0cb168-82d6-45ae-9e7c-b407aa1c6616</loc><lastmod>2026-11-13T04:15:23+03:00</lastmod></url>
      <url><loc> https://contentrewards.com/c/campaigns/d6c42071-e0b9-4faf-8918-3b730cdfcd2d </loc></url>
      <url><loc>https://contentrewards.com/c/campaigns/6c0cb168-82d6-45ae-9e7c-b407aa1c6616</loc></url>
      <url><loc>https://contentrewards.com/c/campaigns/pas-un-identifiant</loc></url>
      <url><loc>https://ailleurs.example/c/campaigns/5fd77a5d-5e3e-4410-b7f3-685e5c120c14</loc></url>
    </urlset>`;
    expect(parseMarketSitemap(xml)).toEqual([
      { campaignId: "6c0cb168-82d6-45ae-9e7c-b407aa1c6616", url: "https://contentrewards.com/c/campaigns/6c0cb168-82d6-45ae-9e7c-b407aa1c6616" },
      { campaignId: "d6c42071-e0b9-4faf-8918-3b730cdfcd2d", url: "https://contentrewards.com/c/campaigns/d6c42071-e0b9-4faf-8918-3b730cdfcd2d" },
    ]);
    expect(parseMarketSitemap("")).toEqual([]);
  });
});

describe("Radar — place de marché : la page d'une campagne", () => {
  it("nom, qui paie, description, tarif, chiffres, et les comptes TikTok de ses meilleurs clips", () => {
    expect(parseCampaignPage(page(OPEN_ROAD, CLIPS, PAIEMENTS))).toEqual({
      name: "Open Road Clipping | $5.25K Budget | $1.25 CPM",
      org: "Clipix",
      description: OPEN_ROAD.description,
      launchedAt: Date.parse("2026-09-09T19:01:02.000Z"),
      rateCents: 125,
      creators: 46,
      views: 589_966,
      spentCents: 169_580,
      // Les clips Instagram et YouTube ne donnent pas de compte TikTok ; un compte vu deux fois compte une fois.
      handles: ["reign.mustang", "leos.m5"],
    });
  });

  it("le contenu poussé par morceaux est remis bout à bout", () => {
    expect(pageFlux('<script>self.__next_f.push([1,"{\\"a\\":\\"é"])</script><script>self.__next_f.push([1,"t\\\\\\"é\\"}"])</script>')).toBe('{"a":"ét\\"é"}');
    expect(pageFlux("<html></html>")).toBe("");
  });

  it("une campagne neuve : aucun créateur, aucun clip ; une campagne qui ne paie pas à la vue n'a pas de tarif", () => {
    const neuve = parseCampaignPage(page({ ...OPEN_ROAD, metrics: { creatorCount: 0, totalViews: 0, budgetSpentCents: 0 } }, [], PAIEMENTS));
    expect([neuve?.creators, neuve?.views, neuve?.handles]).toEqual([0, 0, []]);
    expect(parseCampaignPage(page({ ...OPEN_ROAD, type: "pool" }, CLIPS, PAIEMENTS))?.rateCents).toBeNull();
    // Sans date de lancement : sa date de création.
    expect(parseCampaignPage(page({ ...OPEN_ROAD, launchDate: null }, CLIPS))?.launchedAt).toBe(Date.parse("2026-09-09T19:00:00.000Z"));
  });

  it("une page qui n'est pas une campagne ne se lit pas", () => {
    expect(parseCampaignPage("<html><body>Not found</body></html>")).toBeNull();
    expect(parseCampaignPage(page(null, CLIPS))).toBeNull();
    expect(parseCampaignPage(page({ ...OPEN_ROAD, name: "" }, CLIPS))).toBeNull();
  });
});

describe("Radar — place de marché : le produit promu, dit par l'IA", () => {
  const lot: MarketToJudge[] = [
    { id: "c1", name: "Abby AI [SLIDESHOW]", org: "ClipGenie", description: "Make TikTok slideshow content promoting the Abby AI app" },
    { id: "c2", name: "Call of Duty - Warzone Season 1 Clipping", org: "Clipping Culture", description: "Clip the Warzone Season 1 Trailer" },
    { id: "c3", name: "systeme.io UGC", org: "systeme.io", description: "Show how systeme.io helps entrepreneurs grow their business online." },
    { id: "c4", name: "Open Road Clipping", org: "Clipix", description: "Open Road (@openroadapp) is a drive tracker for iOS and Android." },
  ];

  it("la demande donne à lire le nom, qui paie et la description de chaque campagne", () => {
    const p = marketPrompt(lot);
    expect(p).toContain("id: c1\ncampaign: Abby AI [SLIDESHOW]\nrun by: ClipGenie\ndescription: Make TikTok slideshow content promoting the Abby AI app");
    expect(p.split("\n\n")).toHaveLength(4);
    expect(MARKET_SCHEMA.properties.campaigns.items.properties.kind.enum).toEqual(["app", "software", "game", "other"]);
    expect([MARKET_JUDGE_BATCH, MARKET_READS_PER_RUN, MARKET_BREAKER]).toEqual([25, 40, 4]);
  });

  it("garde une ligne par campagne demandée : nature connue, nom propre, pseudo plausible", () => {
    const reponse = {
      campaigns: [
        { id: "c1", kind: "app", product: "  Abby AI ", handle: "" },
        { id: "c2", kind: "game", product: "Call of Duty: Warzone", handle: "" },
        { id: "c3", kind: "software", product: "systeme.io", handle: "@Systeme.io" },
        { id: "c4", kind: "app", product: "Open Road", handle: "openroadapp" },
      ],
    };
    expect(marketAnswer(reponse, lot)).toEqual([
      { id: "c1", kind: "app", product: "Abby AI", handle: "" },
      // Un jeu ou « autre » n'a pas de produit à suivre.
      { id: "c2", kind: "game", product: "", handle: "" },
      { id: "c3", kind: "software", product: "systeme.io", handle: "systeme.io" },
      { id: "c4", kind: "app", product: "Open Road", handle: "openroadapp" },
    ]);
  });

  it("écarte ce qui n'a pas été demandé, ce qui est répété, et ne propose pas une app sans nom", () => {
    const reponse = {
      campaigns: [
        { id: "inventee", kind: "app", product: "Fantôme", handle: "" },
        { id: "c1", kind: "app", product: "Abby AI", handle: "" },
        { id: "c1", kind: "software", product: "Autre chose", handle: "" },
        { id: "c2", kind: "inconnu", product: "Warzone", handle: "" },
        { id: "c3", kind: "software", product: " — ", handle: "x" },
        { id: "c4", kind: "app", product: "Open Road", handle: "pas un pseudo !" },
        null,
        "texte",
      ],
    };
    expect(marketAnswer(reponse, lot)).toEqual([
      { id: "c1", kind: "app", product: "Abby AI", handle: "" },
      { id: "c2", kind: "other", product: "", handle: "" },
      { id: "c3", kind: "other", product: "", handle: "" },
      { id: "c4", kind: "app", product: "Open Road", handle: "" },
    ]);
    for (const illisible of [null, undefined, "texte", {}, { campaigns: "non" }]) expect(marketAnswer(illisible, lot)).toEqual([]);
  });

  it("une app mobile ou un logiciel se propose ; un jeu, un streamer, une chanson, non", () => {
    expect(["app", "software", "game", "other"].map((k) => isProduct(k as "app"))).toEqual([true, true, false, false]);
  });
});

describe("Radar — place de marché : un produit, ses campagnes", () => {
  it("la clé d'un produit réunit ses campagnes, quelle que soit l'écriture", () => {
    expect(productKey("Abby AI")).toBe("abbyai");
    expect(productKey("abby.ai")).toBe("abbyai");
    expect(productKey("systeme.io")).toBe("systemeio");
    expect(productKey("Toxic: Followers Tracker")).toBe("toxicfollowerstracker");
    expect(productKey(" — ")).toBe("");
    expect(marketCandidateKey("Open Road")).toBe("market:openroad");
  });

  it("les motifs proposés : le nom collé, et le pseudo quand il dit autre chose ; pas un nom de 3 lettres", () => {
    expect(marketPatterns("Open Road", "openroadapp")).toEqual(["openroad", "openroadapp"]);
    expect(marketPatterns("Lookist", "lookist")).toEqual(["lookist"]);
    expect(marketPatterns("Abby AI", "")).toEqual(["abbyai"]);
    expect(marketPatterns("Elb", "")).toEqual([]);
    expect(marketPatterns("Elb", "elb.app")).toEqual(["elbapp"]);
  });

  it("les campagnes d'un produit s'additionnent ; le tarif retenu est le plus haut", () => {
    expect(marketTotals([{ creators: 30, views: 2_161_297, spentCents: 275_300, rateCents: 100 }, { creators: 4, views: 12_000, spentCents: 2_400, rateCents: 200 }, {}])).toEqual({
      campaigns: 3,
      creators: 34,
      views: 2_173_297,
      spentCents: 277_700,
      rateCents: 200,
    });
    expect(marketTotals([{ creators: 2, rateCents: null }])).toEqual({ campaigns: 1, creators: 2, views: 0, spentCents: 0, rateCents: null });
  });
});

describe("Radar — place de marché : la lecture d'une page", () => {
  const rend = (status: number, text = "") => (async () => new Response(text, { status })) as unknown as typeof fetch;

  it("une page servie rend son texte ; 404 ou 410 = campagne retirée ; tout autre refus = suspect", async () => {
    expect(await fetchMarketPage("https://contentrewards.com/sitemap.xml", rend(200, "<urlset/>"))).toEqual({ ok: true, text: "<urlset/>" });
    expect(await fetchMarketPage("https://contentrewards.com/c/campaigns/x", rend(404))).toEqual({ ok: false, kind: "absent" });
    expect(await fetchMarketPage("https://contentrewards.com/c/campaigns/x", rend(410))).toEqual({ ok: false, kind: "absent" });
    for (const refus of [403, 429, 500, 503]) expect(await fetchMarketPage("https://contentrewards.com/x", rend(refus))).toEqual({ ok: false, kind: "suspect" });
    const panne = (async () => {
      throw new Error("réseau");
    }) as unknown as typeof fetch;
    expect(await fetchMarketPage("https://contentrewards.com/x", panne)).toEqual({ ok: false, kind: "suspect" });
  });

  it("on se présente sans en-tête de navigateur", async () => {
    let vus: Record<string, string> = {};
    const espion = (async (_url: string, init?: RequestInit) => {
      vus = (init?.headers ?? {}) as Record<string, string>;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    await fetchMarketPage("https://contentrewards.com/sitemap.xml", espion);
    expect(Object.keys(vus)).toEqual(["Accept"]);
  });

  it("une pause de 1 à 2 secondes entre deux pages", () => {
    expect([marketPauseMs(0), marketPauseMs(1), marketPauseMs(0.5)]).toEqual([MARKET_PAUSE_MIN_MS, MARKET_PAUSE_MAX_MS, 1_500]);
    expect([marketPauseMs(-3), marketPauseMs(7)]).toEqual([1_000, 2_000]);
  });
});
