import { describe, it, expect, vi } from "vitest";
import type { ActionCtx } from "../convex/_generated/server";
import type { Id } from "../convex/_generated/dataModel";
import {
  collectTikTokInternally,
  rescueWithApify,
  nextBreaker,
  pageDelayMs,
  BREAKER_CLOSED,
  BREAKER_THRESHOLD,
  PAGE_DELAY_MIN_MS,
  PAGE_DELAY_MAX_MS,
  type InternalTarget,
  type RescueTarget,
} from "../convex/tiktokInternal";

/**
 * Pages calquées sur la prod : structure relevée le 2026-08-31 (@marine.bn07)
 * et le 2026-09-14 (@ang_creates, `authorStats` + photo signée).
 */
function pageServie(id: string, playCount: number, handle = "marine.bn07"): string {
  return (
    '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">' +
    JSON.stringify({
      __DEFAULT_SCOPE__: {
        "webapp.video-detail": {
          statusCode: 0,
          statusMsg: "",
          itemInfo: {
            itemStruct: {
              id,
              desc: "Heureusement que le site Snytch.co existe pour les filles comme nous.",
              author: {
                uniqueId: handle,
                avatarLarger: `https://p16-common-sign.tiktokcdn-eu.com/avt/${handle}.jpeg?x-expires=1789639200`,
              },
              authorStats: { followerCount: 1_873, followingCount: 41, heartCount: 52_310 },
              stats: {
                playCount,
                diggCount: 1084,
                commentCount: 6,
                collectCount: "108",
                shareCount: 32,
              },
            },
          },
        },
      },
    }) +
    "</script>"
  );
}

const pageRefusee = (code: number, msg: string) =>
  '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">' +
  JSON.stringify({
    __DEFAULT_SCOPE__: { "webapp.video-detail": { statusCode: code, statusMsg: msg } },
  }) +
  "</script>";

/** Page de vérification servie à une IP suspecte : 200, mais aucun payload. */
const CAPTCHA = "<html><body><div id='captcha-verify-container'></div></body></html>";

/** ctx minimal : on enregistre les mutations et actions appelées. */
function fakeCtx() {
  const calls: { args: Record<string, unknown> }[] = [];
  const ctx = {
    runMutation: vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      calls.push({ args });
      return { action: "inserted" as const, streak: 1 };
    }),
  } as unknown as ActionCtx;
  // Les références de fonction Convex ne se comparent pas par identité : on
  // distingue les mutations par la FORME de leurs arguments, qui est disjointe.
  const snapshots = () => calls.filter((c) => "vues" in c.args);
  const echecs = () => calls.filter((c) => "reason" in c.args);
  const profils = () => calls.filter((c) => "followers" in c.args);
  return { ctx, snapshots, echecs, profils };
}

/** Ids TikTok réels (19 chiffres), handles tels qu'en base (@, point, suffixe). */
const cible = (id: string, compte = "@marine.bn07"): InternalTarget => ({
  publicationId: `pub_${id}` as Id<"publications">,
  projectId: "proj_snytch" as Id<"projects">,
  compte,
  key: id,
  url: `https://www.tiktok.com/@${compte.slice(1)}/video/${id}?_r=1&_t=ZN-99jaUjECTLi`,
});

/** fetch qui sert une page par id, à partir d'une table. */
function fetchParId(pages: Record<string, () => Response>) {
  const vus: string[] = [];
  const impl = (async (u: string) => {
    const id = /video\/(\d+)/.exec(u)?.[1] ?? "";
    vus.push(id);
    const f = pages[id];
    return f ? f() : new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  return { impl, vus };
}

const sansPause = { delayMs: () => 0 };

describe("nextBreaker — le coupe-circuit", () => {
  const illisible = { kind: "unreadable" as const, reason: "HTTP 429" };

  it(`coupe à ${BREAKER_THRESHOLD} pages illisibles D'AFFILÉE, pas avant`, () => {
    let s = BREAKER_CLOSED;
    for (let i = 1; i < BREAKER_THRESHOLD; i++) {
      s = nextBreaker(s, illisible);
      expect(s.trippedReason).toBeNull();
    }
    s = nextBreaker(s, illisible);
    expect(s.trippedReason).toContain(`${BREAKER_THRESHOLD} pages illisibles`);
    expect(s.trippedReason).toContain("HTTP 429");
  });

  it("une page SERVIE remet le compteur à zéro — les illisibles isolées ne coupent jamais", () => {
    const refus = { kind: "refused" as const, statusCode: 10204, statusMsg: "status_self_see" };
    let s = BREAKER_CLOSED;
    for (let tour = 0; tour < 10; tour++) {
      for (let i = 1; i < BREAKER_THRESHOLD; i++) s = nextBreaker(s, illisible);
      s = nextBreaker(s, refus);
    }
    expect(s).toEqual(BREAKER_CLOSED);
  });

  it("une fois coupé, il le reste pour la nuit (une page servie ne le rouvre pas)", () => {
    const coupe = { suspects: BREAKER_THRESHOLD, trippedReason: "5 pages illisibles" };
    const stats = {
      kind: "stats" as const,
      stats: { views: 1, likes: null, comments: null, saves: null, shares: null, title: null, authorHandle: null, author: null },
    };
    expect(nextBreaker(coupe, stats)).toBe(coupe);
  });
});

describe("pageDelayMs — rythme de lecture", () => {
  it("reste dans [1,5 s ; 3 s], bornes comprises", () => {
    expect(pageDelayMs(0)).toBe(PAGE_DELAY_MIN_MS);
    expect(pageDelayMs(0.999_999_999_9)).toBe(PAGE_DELAY_MAX_MS);
    expect(pageDelayMs(0.4137)).toBeGreaterThan(PAGE_DELAY_MIN_MS);
    expect(pageDelayMs(0.4137)).toBeLessThan(PAGE_DELAY_MAX_MS);
  });
});

describe("collectTikTokInternally", () => {
  it("écrit le snapshot, saves comprises, et UN profil par compte", async () => {
    const { ctx, snapshots, profils, echecs } = fakeCtx();
    const { impl } = fetchParId({
      "7675779059342642465": () => new Response(pageServie("7675779059342642465", 39_000)),
      "7679420549268835616": () => new Response(pageServie("7679420549268835616", 1_265)),
    });

    const r = await collectTikTokInternally(
      ctx,
      [cible("7675779059342642465"), cible("7679420549268835616")],
      1_789_421_400_000,
      BREAKER_CLOSED,
      { fetchImpl: impl, ...sansPause },
    );

    expect(r.releves).toEqual(["pub_7675779059342642465", "pub_7679420549268835616"]);
    expect(snapshots().map((c) => c.args.vues)).toEqual([39_000, 1_265]);
    expect(snapshots()[0].args).toMatchObject({
      likes: 1_084,
      comments: 6,
      saves: 108,
      capturedAt: 1_789_421_400_000,
      source: "tiktok",
    });
    // Deux vidéos du même compte : les compteurs de compte ne sont écrits qu'une fois.
    expect(profils()).toHaveLength(1);
    expect(profils()[0].args).toMatchObject({ followers: 1_873, following: 41, totalLikes: 52_310 });
    expect(r.avatars).toHaveLength(1);
    expect(r.avatars[0]).toMatchObject({ handle: "@marine.bn07", projectId: "proj_snytch" });
    expect(echecs()).toHaveLength(0);
    expect(r.aSecourir).toEqual([]);
  });

  it("un REFUS est un échec définitif : persisté, et jamais envoyé au secours payant", async () => {
    const { ctx, snapshots, echecs } = fakeCtx();
    const { impl } = fetchParId({
      "7683319137984122133": () => new Response(pageRefusee(10231, "cross_border_violation")),
    });

    const r = await collectTikTokInternally(
      ctx,
      [cible("7683319137984122133", "@cintia_secretacc")],
      42,
      BREAKER_CLOSED,
      { fetchImpl: impl, ...sansPause },
    );

    expect(r.refused).toBe(1);
    // ABSENCE : ni snapshot, ni secours…
    expect(snapshots()).toHaveLength(0);
    expect(r.aSecourir).toEqual([]);
    // …PRÉSENCE : l'échec est bien écrit, avec un motif lisible.
    expect(echecs()).toHaveLength(1);
    expect(echecs()[0].args).toMatchObject({
      publicationId: "pub_7683319137984122133",
      reason: "bloqué hors de sa région par TikTok",
    });
  });

  it("une page ILLISIBLE part au secours SANS échec écrit (le secours décidera)", async () => {
    const { ctx, snapshots, echecs } = fakeCtx();
    const { impl } = fetchParId({
      "7682472454891064606": () => new Response("Too Many Requests", { status: 429 }),
    });

    const r = await collectTikTokInternally(
      ctx,
      [cible("7682472454891064606", "@ang_creates")],
      42,
      BREAKER_CLOSED,
      { fetchImpl: impl, ...sansPause },
    );

    expect(snapshots()).toHaveLength(0);
    expect(echecs()).toHaveLength(0);
    expect(r.aSecourir).toHaveLength(1);
    expect(r.aSecourir[0]).toMatchObject({ key: "7682472454891064606", reason: "HTTP 429" });
    expect(r.breaker.suspects).toBe(1);
  });

  it("COUPE-CIRCUIT : après 5 captchas d'affilée, on cesse de frapper TikTok", async () => {
    const { ctx } = fakeCtx();
    const ids = Array.from({ length: 12 }, (_, i) => `76834${String(10_000_000_000_000 + i * 7_919)}`);
    const pages: Record<string, () => Response> = {};
    for (const id of ids) pages[id] = () => new Response(CAPTCHA, { status: 200 });
    const { impl, vus } = fetchParId(pages);

    const r = await collectTikTokInternally(
      ctx,
      ids.map((id) => cible(id)),
      42,
      BREAKER_CLOSED,
      { fetchImpl: impl, ...sansPause },
    );

    // Exactement 5 pages demandées sur 12 : les 7 suivantes ne sont pas appelées.
    expect(vus).toHaveLength(BREAKER_THRESHOLD);
    expect(r.pages).toBe(BREAKER_THRESHOLD);
    expect(r.breaker.trippedReason).toContain("balise de réhydratation absente");
    // Rien n'est perdu : les 12 posts sont confiés au secours.
    expect(r.aSecourir).toHaveLength(12);
    expect(r.aSecourir[11].reason).toContain("relevé maison suspendu");
  });

  it("un coupe-circuit HÉRITÉ du lot précédent n'appelle aucune page", async () => {
    const { ctx } = fakeCtx();
    const { impl, vus } = fetchParId({});
    const r = await collectTikTokInternally(
      ctx,
      [cible("7685480971474357517", "@gabmar16")],
      42,
      { suspects: 5, trippedReason: "5 pages illisibles d'affilée (dernière : HTTP 403)" },
      { fetchImpl: impl, ...sansPause },
    );
    expect(vus).toEqual([]);
    expect(r.aSecourir).toHaveLength(1);
    expect(r.aSecourir[0].reason).toContain("HTTP 403");
  });

  it("DURÉE dépassée : le reste est NON TENTÉ, ni échec ni secours", async () => {
    const { ctx, echecs } = fakeCtx();
    const { impl, vus } = fetchParId({
      "7675779059342642465": () => new Response(pageServie("7675779059342642465", 39_000)),
    });
    let t = 1_000;
    const r = await collectTikTokInternally(
      ctx,
      [cible("7675779059342642465"), cible("7679420549268835616"), cible("7685481325855395105")],
      42,
      BREAKER_CLOSED,
      // L'horloge avance d'une minute par lecture ; échéance après la première.
      { fetchImpl: impl, ...sansPause, deadline: 1_500, clock: () => (t += 60_000) - 60_000 },
    );
    expect(vus).toEqual(["7675779059342642465"]);
    expect(r.releves).toEqual(["pub_7675779059342642465"]);
    expect(r.nonTentes.map((x) => x.key)).toEqual(["7679420549268835616", "7685481325855395105"]);
    expect(r.aSecourir).toEqual([]);
    expect(echecs()).toHaveLength(0);
  });
});

describe("rescueWithApify — le secours payant, borné", () => {
  const aSecourir = (id: string, reason = "HTTP 429"): RescueTarget => ({ ...cible(id), reason });

  /** Réponse de l'actor clockworks : un item par post rendu. */
  const apifyRend = (items: { id: string; playCount: number }[]) => {
    const appels: string[][] = [];
    const impl = (async (_u: string, init: { body: string }) => {
      appels.push(JSON.parse(init.body).postURLs);
      return new Response(
        JSON.stringify(items.map((i) => ({ id: i.id, playCount: i.playCount, diggCount: 12, commentCount: 1 }))),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    return { impl, appels };
  };

  it("écrit ce qu'Apify rend, inscrit le reste avec les DEUX motifs", async () => {
    const { ctx, snapshots, echecs } = fakeCtx();
    const { impl } = apifyRend([{ id: "7675779059342642465", playCount: 40_112 }]);

    const r = await rescueWithApify(
      ctx,
      [aSecourir("7675779059342642465"), aSecourir("7679420549268835616", "balise de réhydratation absente")],
      42,
      "apify_api_xxx",
      100,
      impl,
    );

    expect(r.releves).toEqual(["pub_7675779059342642465"]);
    expect(snapshots()[0].args).toMatchObject({ vues: 40_112, source: "tiktok" });
    expect(r.failed).toBe(1);
    expect(echecs()[0].args.reason).toBe(
      "balise de réhydratation absente ; Apify n'a pas rendu le post",
    );
    expect(r.budgetRestant).toBe(98);
    expect(r.runs).toBe(1);
  });

  it("au-delà du budget de la nuit, Apify n'est PAS appelé pour le surplus", async () => {
    const { ctx, echecs } = fakeCtx();
    const { impl, appels } = apifyRend([]);
    const cibles = ["7675779059342642465", "7679420549268835616", "7685481325855395105"].map((id) => aSecourir(id));

    const r = await rescueWithApify(ctx, cibles, 42, "apify_api_xxx", 2, impl);

    expect(appels).toHaveLength(1);
    expect(appels[0]).toHaveLength(2);
    expect(r.budgetRestant).toBe(0);
    expect(r.failed).toBe(3);
    expect(echecs()[2].args.reason).toBe(
      "HTTP 429 ; secours Apify reporté (budget de la nuit épuisé)",
    );
  });

  it("sans jeton Apify : aucun appel, chaque post est inscrit avec la raison", async () => {
    const { ctx, echecs } = fakeCtx();
    const { impl, appels } = apifyRend([]);
    const r = await rescueWithApify(ctx, [aSecourir("7675779059342642465")], 42, undefined, 100, impl);
    expect(appels).toHaveLength(0);
    expect(r.budgetRestant).toBe(100);
    expect(echecs()[0].args.reason).toBe(
      "HTTP 429 ; pas de secours Apify (APIFY_API_TOKEN absent)",
    );
  });

  it("crédit Apify épuisé (HTTP 402) : l'échec dit pourquoi", async () => {
    const { ctx, echecs } = fakeCtx();
    const impl = (async () =>
      new Response(JSON.stringify({ error: { message: "Monthly usage hard limit exceeded" } }), {
        status: 402,
      })) as unknown as typeof fetch;
    await rescueWithApify(ctx, [aSecourir("7675779059342642465")], 42, "apify_api_xxx", 100, impl);
    expect(echecs()[0].args.reason).toBe("HTTP 429 ; Apify en erreur (402)");
  });
});
