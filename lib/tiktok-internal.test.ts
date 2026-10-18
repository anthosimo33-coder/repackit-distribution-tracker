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
function pageServie(
  id: string,
  playCount: number,
  handle = "marine.bn07",
  authorId?: string,
): string {
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
                ...(authorId !== undefined ? { id: authorId } : {}),
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

/**
 * ctx dont l'écriture du relevé rend le VERDICT de la mutation (cf
 * convex/postOwner.ts) : `foreign_owner` pour un post prouvé à un autre compte,
 * `sibling` pour un post d'un autre compte de la créatrice. Le verdict lui-même
 * est testé dans lib/post-owner.test.ts ; ici, ce que l'action EN FAIT.
 */
function fakeCtxVerdicts(verdicts: Record<string, { action: string; sibling?: true }>) {
  const calls: { args: Record<string, unknown> }[] = [];
  const ctx = {
    runMutation: vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      calls.push({ args });
      if ("vues" in args) {
        return verdicts[args.publicationId as string] ?? { action: "inserted" };
      }
      return { action: "written" };
    }),
  } as unknown as ActionCtx;
  return {
    ctx,
    snapshots: () => calls.filter((c) => "vues" in c.args),
    profils: () => calls.filter((c) => "followers" in c.args),
  };
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
      // Paliers synchronisés en fin de passage par l'appelant (cf bonusSync).
      differerBonus: true,
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

describe("collectTikTokInternally — l'auteur de la vidéo", () => {
  // Ids et auteurs relevés sur la prod le 18/10/2026 (page publique).
  const KELLY_LEYDIE = "7656852187148796931";
  const KELLY_CHAPTERS = "7673976005312971798";

  it("passe l'auteur de la PAGE à l'écriture — le @ de l'URL n'est qu'un libellé", async () => {
    const { ctx, snapshots } = fakeCtxVerdicts({});
    const { impl } = fetchParId({
      "7697209634930642209": () =>
        new Response(pageServie("7697209634930642209", 774, "sarah_snytch", "7690714507761468438")),
    });
    await collectTikTokInternally(
      ctx,
      // En base @sarah_olv8 (l'ancien nom) ; l'URL dirait n'importe quoi.
      [{ ...cible("7697209634930642209", "@sarah_olv8") }],
      42,
      BREAKER_CLOSED,
      { fetchImpl: impl, ...sansPause },
    );
    expect(snapshots()[0].args).toMatchObject({
      ownerUsername: "sarah_snytch",
      ownerId: "7690714507761468438",
    });
  });

  it("vidéo PROUVÉE à un autre compte : ni relevée, ni profil, ni photo", async () => {
    const { ctx, snapshots, profils } = fakeCtxVerdicts({
      pub_7676941579743005984: { action: "foreign_owner" },
    });
    const { impl } = fetchParId({
      "7676941579743005984": () =>
        new Response(pageServie("7676941579743005984", 1_317, "sarahkl02", "7600000000000000002")),
    });
    const r = await collectTikTokInternally(
      ctx,
      [cible("7676941579743005984", "@marine.bn07")],
      42,
      BREAKER_CLOSED,
      { fetchImpl: impl, ...sansPause },
    );
    // La mutation a été appelée (c'est elle qui juge et marque)…
    expect(snapshots()).toHaveLength(1);
    // …mais l'action ne compte pas la vidéo comme relevée : ni paliers en fin
    // de passage, ni abonnés de @sarahkl02 sur @marine.bn07, ni sa photo.
    expect(r.releves).toEqual([]);
    expect(r.foreign).toBe(1);
    expect(profils()).toHaveLength(0);
    expect(r.avatars).toEqual([]);
  });

  it("CAS KELLY : vidéo de son autre compte → relevée, mais son profil n'est PAS écrit sur ce compte", async () => {
    const { ctx, profils } = fakeCtxVerdicts({
      pub_7684707415018818848: { action: "inserted", sibling: true },
    });
    const { impl } = fetchParId({
      // Le 17/10/2026, cette vidéo de @kellyleydie (1 691 abonnés) a écrit
      // 1 691 abonnés sur @thekellychapters_, qui en avait 373.
      "7684707415018818848": () =>
        new Response(pageServie("7684707415018818848", 3_524, "kellyleydie", KELLY_LEYDIE)),
    });
    const r = await collectTikTokInternally(
      ctx,
      [cible("7684707415018818848", "@thekellychapters_")],
      42,
      BREAKER_CLOSED,
      { fetchImpl: impl, ...sansPause },
    );
    expect(r.releves).toEqual(["pub_7684707415018818848"]);
    expect(profils()).toHaveLength(0);
    expect(r.avatars).toEqual([]);
  });

  it("le profil du compte vient d'une vidéo À LUI, même quand une vidéo sœur passe avant", async () => {
    const { ctx, profils } = fakeCtxVerdicts({
      pub_7684707415018818848: { action: "inserted", sibling: true },
    });
    const { impl } = fetchParId({
      "7684707415018818848": () =>
        new Response(pageServie("7684707415018818848", 3_524, "kellyleydie", KELLY_LEYDIE)),
      "7695499014271257889": () =>
        new Response(pageServie("7695499014271257889", 518, "thekellychapters_", KELLY_CHAPTERS)),
    });
    await collectTikTokInternally(
      ctx,
      [cible("7684707415018818848", "@thekellychapters_"), cible("7695499014271257889", "@thekellychapters_")],
      42,
      BREAKER_CLOSED,
      { fetchImpl: impl, ...sansPause },
    );
    expect(profils()).toHaveLength(1);
    expect(profils()[0].args.publicationId).toBe("pub_7695499014271257889");
  });

  it("les vidéos qui CONFIRMENT le compte sont écrites avant celles d'un autre auteur", async () => {
    const { ctx, snapshots } = fakeCtxVerdicts({});
    const { impl } = fetchParId({
      "7676941579743005984": () =>
        new Response(pageServie("7676941579743005984", 1_317, "sarahkl02", "7600000000000000002")),
      "7675779059342642465": () =>
        new Response(pageServie("7675779059342642465", 39_000, "marine.bn07", "7600000000000000001")),
    });
    await collectTikTokInternally(
      ctx,
      // La vidéo étrangère est LUE en premier…
      [cible("7676941579743005984", "@marine.bn07"), cible("7675779059342642465", "@marine.bn07")],
      42,
      BREAKER_CLOSED,
      { fetchImpl: impl, ...sansPause },
    );
    // …mais écrite en dernier : l'identité de @marine.bn07 est apprise d'abord,
    // et la vidéo de @sarahkl02 est jugée contre elle dès ce passage.
    expect(snapshots().map((c) => c.args.publicationId)).toEqual([
      "pub_7675779059342642465",
      "pub_7676941579743005984",
    ]);
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
    expect(snapshots()[0].args).toMatchObject({
      vues: 40_112,
      source: "tiktok",
      differerBonus: true,
    });
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

  it("passe l'auteur authorMeta, confirme d'abord, et ne compte pas un post étranger comme relevé", async () => {
    const { ctx, snapshots } = fakeCtxVerdicts({
      pub_7676941579743005984: { action: "foreign_owner" },
    });
    const impl = (async () =>
      new Response(
        JSON.stringify([
          { id: "7676941579743005984", playCount: 1_317, authorMeta: { name: "sarahkl02", id: "7600000000000000002" } },
          { id: "7675779059342642465", playCount: 39_000, authorMeta: { name: "marine.bn07", id: "7600000000000000001" } },
        ]),
        { status: 200 },
      )) as unknown as typeof fetch;
    const r = await rescueWithApify(
      ctx,
      [aSecourir("7676941579743005984"), aSecourir("7675779059342642465")],
      42,
      "apify_api_xxx",
      100,
      impl,
    );
    expect(snapshots().map((c) => [c.args.publicationId, c.args.ownerUsername, c.args.ownerId])).toEqual([
      ["pub_7675779059342642465", "marine.bn07", "7600000000000000001"],
      ["pub_7676941579743005984", "sarahkl02", "7600000000000000002"],
    ]);
    expect(r.releves).toEqual(["pub_7675779059342642465"]);
    expect(r.foreign).toBe(1);
    expect(r.failed).toBe(0);
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
    expect(echecs()[0].args.reason).toBe(
      "HTTP 429 ; crédit Apify épuisé (limite mensuelle du plan atteinte)",
    );
  });
});
