import { describe, it, expect, vi } from "vitest";
import type { ActionCtx } from "../convex/_generated/server";
import type { Id } from "../convex/_generated/dataModel";
import {
  collectSnapchatInternally,
  collectSnapchatProfiles,
  type SnapchatTarget,
} from "../convex/snapchatInternal";
import { BREAKER_CLOSED, BREAKER_THRESHOLD } from "../convex/tiktokInternal";

/** Page Spotlight de la forme relevée le 2026-09-25 (compteurs en chaînes). */
function pageSpotlight(id: string, views: string, username = "kelly.snytch"): string {
  const meta = {
    uploadDateMs: "1789420663702",
    viewCount: views,
    shareCount: "0",
    creator: { personCreator: { username, followerCount: "0" } },
  };
  return (
    '<script id="__NEXT_DATA__" type="application/json">' +
    JSON.stringify({
      props: {
        pageProps: {
          videoMetadata: meta,
          spotlightFeed: {
            spotlightStories: [
              {
                story: { storyId: { value: id }, snapList: [{ snapId: { value: id } }] },
                metadata: {
                  videoMetadata: meta,
                  engagementStats: {
                    viewCount: views,
                    boostCount: "1204",
                    commentCount: "38",
                    shareCount: "17",
                    recommendCount: "51",
                  },
                },
              },
            ],
          },
        },
      },
    }) +
    "</script>"
  );
}

/** Page de vérification : 200, mais aucun payload. */
const CAPTCHA = "<html><body><div id='challenge'></div></body></html>";

function fakeCtx() {
  const calls: { args: Record<string, unknown> }[] = [];
  const ctx = {
    runMutation: vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      calls.push({ args });
      return { action: "inserted" as const, streak: 1 };
    }),
  } as unknown as ActionCtx;
  const snapshots = () => calls.filter((c) => "vues" in c.args);
  const echecs = () => calls.filter((c) => "reason" in c.args);
  const profils = () => calls.filter((c) => "followers" in c.args);
  return { ctx, snapshots, echecs, profils };
}

/** Identifiants Spotlight de forme réelle (base64url, ~58 caractères). */
const sid = (n: number) => `W7_EDlXWTBiXAEEniNoMPwAAY${String(n).padStart(8, "0")}AaChyLxkAaChyHOWAAAAAQ`;

const cible = (id: string, compte = "@kelly.snytch"): SnapchatTarget => ({
  publicationId: `pub_${id.slice(25, 33)}` as Id<"publications">,
  projectId: "proj_snytch" as Id<"projects">,
  compte,
  key: id,
  url: `https://www.snapchat.com/@${compte.slice(1)}/spotlight/${id}?share_id=MTIz&locale=fr-FR`,
});

function fetchParId(pages: Record<string, () => Response>) {
  const vus: string[] = [];
  const impl = (async (u: string) => {
    const id = /spotlight\/([A-Za-z0-9_-]+)/.exec(u)?.[1] ?? "";
    vus.push(id);
    const f = pages[id];
    return f ? f() : new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  return { impl, vus };
}

const sansPause = { delayMs: () => 0 };

describe("collectSnapchatInternally", () => {
  it("écrit le snapshot : likes = boostCount, saves null (Snapchat n'en expose pas)", async () => {
    const { ctx, snapshots, echecs } = fakeCtx();
    const { impl } = fetchParId({ [sid(1)]: () => new Response(pageSpotlight(sid(1), "48213")) });

    const r = await collectSnapchatInternally(ctx, [cible(sid(1))], 1_790_000_000_000, BREAKER_CLOSED, {
      fetchImpl: impl,
      ...sansPause,
    });

    expect(r.releves).toEqual([`pub_${sid(1).slice(25, 33)}`]);
    expect(snapshots()).toHaveLength(1);
    expect(snapshots()[0].args).toMatchObject({
      vues: 48_213,
      likes: 1_204,
      comments: 38,
      saves: null,
      capturedAt: 1_790_000_000_000,
      source: "snapchat",
      differerBonus: true,
    });
    expect(echecs()).toHaveLength(0);
  });

  it("un Spotlight SUPPRIMÉ (404) est un échec persisté, SANS faire avancer le coupe-circuit", async () => {
    const { ctx, snapshots, echecs } = fakeCtx();
    const { impl } = fetchParId({});
    const r = await collectSnapchatInternally(ctx, [cible(sid(2))], 42, BREAKER_CLOSED, {
      fetchImpl: impl,
      ...sansPause,
    });
    expect(snapshots()).toHaveLength(0);
    expect(r.gone).toBe(1);
    expect(r.breaker.suspects).toBe(0);
    // PRÉSENCE : l'échec est écrit, avec un motif qui dit « supprimé ».
    expect(echecs()).toHaveLength(1);
    expect(String(echecs()[0].args.reason)).toMatch(/introuvable/);
  });

  it("une page ILLISIBLE est inscrite en échec tout de suite — pas de secours payant", async () => {
    const { ctx, echecs } = fakeCtx();
    const { impl } = fetchParId({ [sid(3)]: () => new Response("Too Many Requests", { status: 429 }) });
    const r = await collectSnapchatInternally(ctx, [cible(sid(3))], 42, BREAKER_CLOSED, {
      fetchImpl: impl,
      ...sansPause,
    });
    expect(r.failed).toBe(1);
    expect(r.breaker.suspects).toBe(1);
    expect(echecs()[0].args).toMatchObject({ reason: "HTTP 429" });
  });

  it(`COUPE-CIRCUIT : après ${BREAKER_THRESHOLD} pages illisibles, plus aucune page demandée`, async () => {
    const { ctx, echecs } = fakeCtx();
    const ids = Array.from({ length: 9 }, (_, i) => sid(100 + i));
    const pages: Record<string, () => Response> = {};
    for (const id of ids) pages[id] = () => new Response(CAPTCHA, { status: 200 });
    const { impl, vus } = fetchParId(pages);

    const r = await collectSnapchatInternally(ctx, ids.map((id) => cible(id)), 42, BREAKER_CLOSED, {
      fetchImpl: impl,
      ...sansPause,
    });

    expect(vus).toHaveLength(BREAKER_THRESHOLD);
    expect(r.breaker.trippedReason).toContain("__NEXT_DATA__");
    // Aucun post n'est laissé sans motif : les 4 non demandés disent pourquoi.
    expect(echecs()).toHaveLength(9);
    expect(String(echecs()[8].args.reason)).toContain("suspendu");
  });

  it("DURÉE dépassée : le reste est NON TENTÉ, ni échec ni snapshot", async () => {
    const { ctx, echecs } = fakeCtx();
    const { impl, vus } = fetchParId({ [sid(7)]: () => new Response(pageSpotlight(sid(7), "902")) });
    let t = 1_000;
    const r = await collectSnapchatInternally(ctx, [cible(sid(7)), cible(sid(8))], 42, BREAKER_CLOSED, {
      fetchImpl: impl,
      ...sansPause,
      deadline: 1_500,
      clock: () => (t += 60_000) - 60_000,
    });
    expect(vus).toEqual([sid(7)]);
    expect(r.nonTentes.map((x) => x.key)).toEqual([sid(8)]);
    expect(echecs()).toHaveLength(0);
  });

  it("lien court (clé vide) : la page est demandée et l'id relu après redirection", async () => {
    const { ctx, snapshots } = fakeCtx();
    const impl = (async () =>
      ({
        ok: true,
        status: 200,
        url: `https://www.snapchat.com/@kelly.snytch/spotlight/${sid(9)}`,
        text: async () => pageSpotlight(sid(9), "3310"),
      }) as unknown as Response) as unknown as typeof fetch;
    const r = await collectSnapchatInternally(
      ctx,
      [{ ...cible(sid(9)), key: "", url: "https://www.snapchat.com/t/AbCdEf12" }],
      42,
      BREAKER_CLOSED,
      { fetchImpl: impl, ...sansPause },
    );
    expect(r.releves).toHaveLength(1);
    expect(snapshots()[0].args).toMatchObject({ vues: 3_310 });
  });
});

describe("collectSnapchatProfiles", () => {
  const pageProfil = (subs: string) =>
    '<script id="__NEXT_DATA__" type="application/json">' +
    JSON.stringify({
      props: {
        pageProps: {
          userProfile: {
            publicProfileInfo: {
              username: "kelly.snytch",
              subscriberCount: subs,
              profilePictureUrl: "https://cf-st.sc-cdn.net/aps/bolt/kelly.png",
            },
          },
        },
      },
    }) +
    "</script>";

  it("écrit les abonnés par compte et remonte la photo", async () => {
    const { ctx, profils } = fakeCtx();
    const impl = (async () => new Response(pageProfil("12450"))) as unknown as typeof fetch;
    const r = await collectSnapchatProfiles(
      ctx,
      [
        {
          compteId: "cpt_kelly" as Id<"comptes">,
          projectId: "proj_snytch" as Id<"projects">,
          handle: "@kelly.snytch",
          profileUrl: "https://www.snapchat.com/add/kelly.snytch",
        },
      ],
      42,
      { fetchImpl: impl, ...sansPause },
    );
    expect(profils()).toHaveLength(1);
    expect(profils()[0].args).toMatchObject({ compteId: "cpt_kelly", followers: 12_450, source: "snapchat" });
    expect(r.avatars).toEqual([
      { projectId: "proj_snytch", handle: "@kelly.snytch", sourceUrl: "https://cf-st.sc-cdn.net/aps/bolt/kelly.png" },
    ]);
  });
});
