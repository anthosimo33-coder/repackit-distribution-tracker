import { test, expect } from "@playwright/test";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";
import { createFormatWithRate } from "./helpers/formats";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/**
 * Chantier C — preuves SERVEUR du modèle multi-plateforme (1 vidéo → N posts) :
 *   - une cible doit être un compte DISPONIBLE (warmup terminé) ; un compte en
 *     warmup est REFUSÉ ;
 *   - à to_publish, TOUTES les URLs sont requises (1 par cible) ;
 *   - à la publication : N publications matérialisées + N lineItems base (N×base) ;
 *   - idempotence (re-confirmer ne double rien) ;
 *   - bonus de vues SOMMÉ sur les N publications ;
 *   - isolation créateur.
 */
test.describe("Multi-plateforme — cibles warmup-gated, paiement par post", () => {
  test("création multi-cibles + publication multi-URL + paiement par post + idempotence + bonus sommé", async () => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const A = await createCreatorSession(url, {
      name: `[E2E_TEST] Multi ${ts}`,
      email: `e2e-creator-multi-${ts}@repackit.test`,
      password: "creator-multi-12345",
    });
    const projectId = A.projectId;
    const due = ts + 7 * DAY;
    const tkUrl = `https://www.tiktok.com/@x/video/${ts}`;
    const ytUrl = `https://www.youtube.com/watch?v=mt${ts}`;

    const formatId = await createFormatWithRate(admin, {
      name: `[E2E_TEST] MultiFmt ${ts}`,
      type: "short",
      rateModel: { basePerPost: 10, viewBonusPer1k: 2 },
    });

    // 2 comptes DISPONIBLES (TikTok + YouTube) + 1 Instagram EN WARMUP (déclaré,
    // non complété → indisponible).
    const tk = await availableTarget({
      e2eClient: admin,
      creatorId: A.creatorId,
      platform: "TikTok",
      handle: `@e2emt_tk${ts}`,
    });
    const yt = await availableTarget({
      e2eClient: admin,
      creatorId: A.creatorId,
      platform: "YouTube",
      handle: `@e2emt_yt${ts}`,
    });
    const igWarmupId = await A.client.mutation(api.comptes.declareCompte, {
      projectId,
      plateforme: "Instagram",
      handle: `@e2emt_ig${ts}`,
    });

    // ── 1. Un compte EN WARMUP ne peut PAS être une cible. ───────────────────
    await expect(
      admin.mutation(api.assignments.assignFormat, {
        formatId,
        creatorId: A.creatorId,
        targets: [{ platform: "Instagram", accountId: igWarmupId }],
        postsPerCreator: 1,
        dueDate: due,
      }),
    ).rejects.toThrow(/warmup/i);

    // ── 2. Création multi-cibles (TikTok + YouTube) : 1 vidéo → 2 posts. ─────
    const r = await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: A.creatorId,
      targets: [tk, yt],
      postsPerCreator: 1,
      dueDate: due,
    });
    expect(r.created).toBe(1);
    const a = (await admin.query(api.assignments.listAssignments, {})).find(
      (x) => x.formatId === formatId && x.creatorId === A.creatorId,
    )!;
    expect(a.targets.length).toBe(2);

    // ── 3. to_publish (on saute la revue vidéo). ─────────────────────────────
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: a._id,
      status: "to_publish",
    });

    // ── 4. Une URL MANQUANTE (YouTube) → confirmation REFUSÉE. ───────────────
    await expect(
      A.client.mutation(api.assignments.confirmPublication, {
        projectId,
        id: a._id,
        urls: [{ platform: "TikTok", url: tkUrl }],
      }),
    ).rejects.toThrow(/manquante|YouTube/i);

    // ── 5. Les 2 URLs → published : 2 pubs + 2 lineItems base (2 × 10 = 20). ──
    const pub = await A.client.mutation(api.assignments.confirmPublication, {
      projectId,
      id: a._id,
      urls: [
        { platform: "TikTok", url: tkUrl },
        { platform: "YouTube", url: ytUrl },
      ],
    });
    expect(pub.alreadyPublished).toBe(false);
    expect(pub.publicationIds.length).toBe(2);

    const pubs = (await admin.query(api.publications.listPublications, {})).filter(
      (p) => p.postUrl === tkUrl || p.postUrl === ytUrl,
    );
    expect(pubs.length).toBe(2);
    expect(new Set(pubs.map((p) => p.plateforme))).toEqual(
      new Set(["TikTok", "YouTube"]),
    );

    const payOf = async () =>
      (await admin.query(api.payments.listPayments, {})).find(
        (p) => p.creatorId === A.creatorId,
      )!;
    const pay = await payOf();
    expect(
      pay.lineItems.filter(
        (li) => li.kind === "base" && li.assignmentId === a._id,
      ).length,
    ).toBe(2);
    expect(pay.totalDue).toBe(20);

    // ── 6. Idempotence : re-confirmer ne double NI pubs NI paiement. ─────────
    const again = await A.client.mutation(api.assignments.confirmPublication, {
      projectId,
      id: a._id,
      urls: [
        { platform: "TikTok", url: tkUrl },
        { platform: "YouTube", url: ytUrl },
      ],
    });
    expect(again.alreadyPublished).toBe(true);
    const pubsCount = (
      await admin.query(api.publications.listPublications, {})
    ).filter((p) => p.postUrl === tkUrl || p.postUrl === ytUrl).length;
    expect(pubsCount).toBe(2);
    expect((await payOf()).totalDue).toBe(20);

    // ── 7. Bonus de vues SOMMÉ sur les N publications. ───────────────────────
    const tkPub = pubs.find((p) => p.plateforme === "TikTok")!;
    const ytPub = pubs.find((p) => p.plateforme === "YouTube")!;
    await admin.mutation(api.metricSnapshots.createSnapshot, {
      publicationId: tkPub._id,
      capturedAt: ts + 3 * DAY,
      vues: 3000,
      likes: 0,
    });
    await admin.mutation(api.metricSnapshots.createSnapshot, {
      publicationId: ytPub._id,
      capturedAt: ts + 3 * DAY,
      vues: 2000,
      likes: 0,
    });
    // 5000 vues cumulées × 2 $/1k = 10 $.
    const bonus = await admin.mutation(api.assignments.computeViewBonus, {
      id: a._id,
      views: 5000,
    });
    expect(bonus.bonus).toBe(10);

    // ── 8. Isolation : un autre créateur ne voit pas l'assignment de A. ──────
    const B = await createCreatorSession(url, {
      name: `[E2E_TEST] Multi B ${ts}`,
      email: `e2e-creator-multi-b-${ts}@repackit.test`,
      password: "creator-multi-b-12345",
    });
    expect(
      await B.client.query(api.assignments.getMyAssignment, {
        projectId: B.projectId,
        id: a._id,
      }),
    ).toBeNull();
  });

  test("Facebook et Snapchat : une mission sur les 5 plateformes, publiée et payée par post", async () => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const A = await createCreatorSession(url, {
      name: `[E2E_TEST] Cinq ${ts}`,
      email: `e2e-creator-cinq-${ts}@repackit.test`,
      password: "creator-cinq-12345",
    });
    const projectId = A.projectId;
    const formatId = await createFormatWithRate(admin, {
      name: `[E2E_TEST] CinqFmt ${ts}`,
      type: "short",
      rateModel: { basePerPost: 10, viewBonusPer1k: 2 },
    });
    const target = (platform: "TikTok" | "Instagram" | "YouTube" | "Facebook" | "Snapchat", h: string) =>
      availableTarget({ e2eClient: admin, creatorId: A.creatorId, platform, handle: `@e2e5_${h}${ts}` });
    const targets = [
      await target("TikTok", "tk"),
      await target("Instagram", "ig"),
      await target("YouTube", "yt"),
      await target("Facebook", "fb"),
      await target("Snapchat", "sc"),
    ];

    // Jusqu'ici une mission portait 3 cibles au plus : 5 était refusé.
    const r = await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: A.creatorId,
      targets,
      postsPerCreator: 1,
      dueDate: ts + 7 * DAY,
    });
    expect(r.created).toBe(1);
    const a = (await admin.query(api.assignments.listAssignments, {})).find(
      (x) => x.formatId === formatId && x.creatorId === A.creatorId,
    )!;
    expect(a.targets.map((t) => t.platform).sort()).toEqual(
      ["Facebook", "Instagram", "Snapchat", "TikTok", "YouTube"],
    );
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: a._id,
      status: "to_publish",
    });

    // Liens copiés tels que les apps les donnent (partage Facebook, Spotlight
    // sous le profil avec ses paramètres de partage).
    const urls = [
      { platform: "TikTok" as const, url: `https://www.tiktok.com/@e2e5_tk${ts}/video/${ts}` },
      { platform: "Instagram" as const, url: `https://www.instagram.com/reel/C${ts}x/?igsh=MXYz` },
      { platform: "YouTube" as const, url: `https://www.youtube.com/shorts/y${ts}` },
      { platform: "Facebook" as const, url: `https://www.facebook.com/share/r/1Ab${ts}/?mibextid=wwXIfr` },
      {
        platform: "Snapchat" as const,
        url: `https://www.snapchat.com/@e2e5_sc${ts}/spotlight/W7_EDlXWTBiXAEEniNoMPwAA${ts}AAAAAQ?share_id=MTIz&locale=fr-FR`,
      },
    ];
    const swap = (platform: string, url: string) =>
      urls.map((u) => (u.platform === platform ? { ...u, url } : u));

    // Un Reel Facebook collé sur la cible Instagram : même maison, autre plateforme.
    await expect(
      A.client.mutation(api.assignments.confirmPublication, {
        projectId,
        id: a._id,
        urls: swap("Instagram", `https://www.facebook.com/reel/${ts}`),
      }),
    ).rejects.toThrow(/ne correspond pas|WRONG_PLATFORM/i);
    // Un lien de PROFIL Snapchat au lieu du Spotlight : aucune vue à relever.
    await expect(
      A.client.mutation(api.assignments.confirmPublication, {
        projectId,
        id: a._id,
        urls: swap("Snapchat", `https://www.snapchat.com/add/e2e5_sc${ts}?share_id=MTIz`),
      }),
    ).rejects.toThrow(/profil|IS_ACCOUNT/i);

    const pub = await A.client.mutation(api.assignments.confirmPublication, {
      projectId,
      id: a._id,
      urls,
    });
    expect(pub.publicationIds.length).toBe(5);
    const pubs = (await admin.query(api.publications.listPublications, {})).filter(
      (p) => urls.some((u) => u.url === p.postUrl),
    );
    expect(pubs.map((p) => p.plateforme).sort()).toEqual(
      ["Facebook", "Instagram", "Snapchat", "TikTok", "YouTube"],
    );
    const pay = (await admin.query(api.payments.listPayments, {})).find(
      (p) => p.creatorId === A.creatorId,
    )!;
    const base = pay.lineItems.filter(
      (li) => li.kind === "base" && li.assignmentId === a._id,
    );
    expect(base.map((li) => li.platform).sort()).toEqual(
      ["Facebook", "Instagram", "Snapchat", "TikTok", "YouTube"],
    );
    expect(pay.totalDue).toBe(50);
  });
});
