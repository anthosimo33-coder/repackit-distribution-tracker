import { describe, it, expect, vi } from "vitest";
import type { ActionCtx } from "../convex/_generated/server";
import type { Id } from "../convex/_generated/dataModel";
import {
  recoverMissingTikTokPosts,
  MAX_FALLBACK_FETCHES,
} from "../convex/tiktokFallback";

/** Page réelle (structure et valeurs relevées le 2026-08-31 sur @marine.bn07). */
function pageServie(id: string, playCount: number): string {
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
              author: { uniqueId: "marine.bn07" },
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

const PAGE_REFUSEE =
  '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">' +
  JSON.stringify({
    __DEFAULT_SCOPE__: {
      "webapp.video-detail": {
        statusCode: 10204,
        statusMsg: "item_privacy_authorization&status_self_see",
      },
    },
  }) +
  "</script>";

/** ctx minimal : on enregistre les mutations appelées, rien d'autre. */
function fakeCtx() {
  const calls: { ref: unknown; args: Record<string, unknown> }[] = [];
  const ctx = {
    runMutation: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
      calls.push({ ref, args });
      return { action: "inserted" as const, streak: 1 };
    }),
  } as unknown as ActionCtx;
  // Les références de fonction Convex ne sont pas comparables par identité
  // (elles sont créées à chaque accès de propriété) : on distingue les deux
  // mutations par la FORME de leurs arguments, qui est disjointe.
  const snapshots = () => calls.filter((c) => "vues" in c.args);
  const echecs = () => calls.filter((c) => "reason" in c.args);
  return { ctx, calls, snapshots, echecs };
}

const cible = (id: string) => ({
  publicationId: `pub_${id}` as Id<"publications">,
  key: id,
  url: `https://www.tiktok.com/@marine.bn07/video/${id}?_r=1&_t=ZN-9`,
});

describe("recoverMissingTikTokPosts", () => {
  it("rattrape un post qu'Apify a abandonné et écrit son snapshot", async () => {
    const { ctx, snapshots, echecs } = fakeCtx();
    const fetchImpl = (async () =>
      new Response(pageServie("7675779059342642465", 39_000), {
        status: 200,
      })) as unknown as typeof fetch;

    const r = await recoverMissingTikTokPosts(
      ctx,
      [cible("7675779059342642465")],
      1_700_000_000_000,
      { fetchImpl },
    );

    expect(r.recovered).toBe(1);
    expect(r.refused).toBe(0);
    expect(r.unreadable).toBe(0);
    expect(r.recoveredIds).toEqual(["pub_7675779059342642465"]);
    // Le snapshot porte les VRAIS compteurs, saves comprises (qu'Apify ne donne
    // pas sur cette route).
    expect(echecs()).toHaveLength(0);
    expect(snapshots()).toHaveLength(1);
    expect(snapshots()[0].args).toMatchObject({
      publicationId: "pub_7675779059342642465",
      vues: 39_000,
      likes: 1_084,
      comments: 6,
      saves: 108,
      capturedAt: 1_700_000_000_000,
      source: "tiktok",
    });
  });

  it("un post que TikTok refuse est enregistré en ÉCHEC, avec son motif lisible", async () => {
    const { ctx, snapshots, echecs } = fakeCtx();
    const fetchImpl = (async () =>
      new Response(PAGE_REFUSEE, { status: 200 })) as unknown as typeof fetch;

    const r = await recoverMissingTikTokPosts(
      ctx,
      [cible("7670619092625231137")],
      42,
      { fetchImpl },
    );

    expect(r.refused).toBe(1);
    expect(r.recovered).toBe(0);
    // ABSENCE : aucun snapshot n'est écrit…
    expect(r.recoveredIds).toEqual([]);
    expect(snapshots()).toHaveLength(0);
    // …PRÉSENCE : mais l'échec, lui, est bien persisté avec le motif en clair.
    expect(echecs()).toHaveLength(1);
    expect(echecs()[0].args).toMatchObject({
      publicationId: "pub_7670619092625231137",
      at: 42,
      reason: "visible par son autrice uniquement",
    });
  });

  it("une page illisible n'écrit AUCUN snapshot (jamais 0 vue)", async () => {
    const { ctx, snapshots, echecs } = fakeCtx();
    const fetchImpl = (async () =>
      new Response("bloqué", { status: 429 })) as unknown as typeof fetch;

    const r = await recoverMissingTikTokPosts(ctx, [cible("1")], 42, { fetchImpl });
    expect(r.unreadable).toBe(1);
    expect(r.recovered).toBe(0);
    expect(snapshots()).toHaveLength(0);
    expect(echecs()[0].args).toMatchObject({ reason: "HTTP 429" });
  });

  it("ne rattrape PAS avec les compteurs d'un autre post", async () => {
    const { ctx } = fakeCtx();
    // La page servie porte un AUTRE id que celui demandé.
    const fetchImpl = (async () =>
      new Response(pageServie("9999999999999999999", 123_456), {
        status: 200,
      })) as unknown as typeof fetch;

    const r = await recoverMissingTikTokPosts(
      ctx,
      [cible("7675779059342642465")],
      42,
      { fetchImpl },
    );
    expect(r.recovered).toBe(0);
    expect(r.unreadable).toBe(1);
  });

  it("plafonne les appels et REPORTE le reste, sans le perdre", async () => {
    const { ctx, echecs } = fakeCtx();
    let appels = 0;
    const fetchImpl = (async () => {
      appels += 1;
      return new Response(PAGE_REFUSEE, { status: 200 });
    }) as unknown as typeof fetch;

    const cibles = Array.from({ length: MAX_FALLBACK_FETCHES + 3 }, (_, i) =>
      cible(String(1_000_000 + i)),
    );
    // delayMs: 0 — la temporisation est testée pour EXISTER, pas pour durer.
    const r = await recoverMissingTikTokPosts(ctx, cibles, 42, {
      fetchImpl,
      delayMs: 0,
    });

    // Le plafond borne les APPELS RÉSEAU…
    expect(appels).toBe(MAX_FALLBACK_FETCHES);
    expect(r.deferred).toBe(3);
    // …mais les reportés sont quand même comptés en échec, sinon leur streak
    // n'augmenterait jamais et ils resteraient invisibles.
    const e = echecs();
    expect(e).toHaveLength(MAX_FALLBACK_FETCHES + 3);
    expect(e[e.length - 1].args.reason).toContain("reporté");
  });

  it("TEMPORISE entre deux pages — c'est ce qui protège le repli", () => {
    // Le test du plafond ci-dessus passe `delayMs: 0` pour rester rapide ; sans
    // cette assertion-ci, retirer la temporisation ne casserait AUCUN test et le
    // repli partirait en rafale sur une IP unique.
    return (async () => {
      const { ctx } = fakeCtx();
      const fetchImpl = (async () =>
        new Response(PAGE_REFUSEE, { status: 200 })) as unknown as typeof fetch;
      const t0 = Date.now();
      await recoverMissingTikTokPosts(
        ctx,
        [cible("1"), cible("2"), cible("3")],
        42,
        { fetchImpl, delayMs: 40 },
      );
      // 3 pages ⇒ 2 pauses. On vérifie l'ORDRE DE GRANDEUR, pas la précision
      // d'un timer (marge basse volontaire : un runner chargé peut dériver).
      expect(Date.now() - t0).toBeGreaterThanOrEqual(70);
    })();
  });
});
