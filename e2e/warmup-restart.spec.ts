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
 * Relance admin du warmup (restartWarmup) — preuves SERVEUR :
 *   - un compte ACTIF (déjà publié) repasse en warmup 7 j (TikTok), compteur de
 *     checks remis à zéro → warmup-gated ;
 *   - le créateur le voit « en warmup » (listMyComptes) ;
 *   - la relance NE SUPPRIME PAS l'historique : publication + assignments
 *     existants conservés ;
 *   - publication BLOQUÉE : un assignment to_publish en cours sur ce compte ne
 *     peut plus être confirmé, et le compte ne peut plus être ciblé par un
 *     nouvel assignment, tant que l'échauffement relancé n'est pas terminé.
 */
test.describe("Warmup — relance admin (restartWarmup)", () => {
  test("actif→warmup 7j, gated, créateur le voit, historique conservé, publication bloquée", async () => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const A = await createCreatorSession(url, {
      name: `[E2E_TEST] Restart ${ts}`,
      email: `e2e-creator-restart-${ts}@repackit.test`,
      password: "creator-restart-12345",
    });
    const projectId = A.projectId;
    const due = ts + 7 * DAY;
    const tkUrl = `https://www.tiktok.com/@x/video/${ts}`;

    // Compte TikTok ACTIF (disponible) lié au créateur.
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: A.creatorId,
      platform: "TikTok",
      handle: `@e2erestart_tk${ts}`,
    });
    const accountId = target.accountId;

    // ── A1 : assignment PUBLIÉ sur ce compte (le compte « a déjà publié »). ────
    const fmt1 = await createFormatWithRate(admin, {
      name: `[E2E_TEST] RestartFmt1 ${ts}`,
      type: "short",
      rateModel: { basePerPost: 10, viewBonusPer1k: 2 },
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId: fmt1,
      creatorId: A.creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: due,
    });
    const a1 = (await admin.query(api.assignments.listAssignments, {})).find(
      (x) => x.formatId === fmt1 && x.creatorId === A.creatorId,
    )!;
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: a1._id,
      status: "to_publish",
    });
    const pub = await A.client.mutation(api.assignments.confirmPublication, {
      projectId,
      id: a1._id,
      urls: [{ platform: "TikTok", url: tkUrl }],
    });
    expect(pub.publicationIds.length).toBe(1);

    // ── A2 : assignment EN COURS (to_publish, non encore publié) sur ce compte. ─
    const fmt2 = await createFormatWithRate(admin, {
      name: `[E2E_TEST] RestartFmt2 ${ts}`,
      type: "short",
      rateModel: { basePerPost: 10, viewBonusPer1k: 2 },
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId: fmt2,
      creatorId: A.creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: due,
    });
    const a2 = (await admin.query(api.assignments.listAssignments, {})).find(
      (x) => x.formatId === fmt2 && x.creatorId === A.creatorId,
    )!;
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: a2._id,
      status: "to_publish",
    });

    // ── RELANCE du warmup (admin). ───────────────────────────────────────────
    const res = await admin.mutation(api.comptes.restartWarmup, {
      id: accountId,
    });
    expect(res.targetDays).toBe(7);

    // ── Le compte repasse en warmup 7 j, compteur de checks à zéro. ──────────
    const compte = (await admin.query(api.comptes.listComptes, {})).find(
      (c) => c._id === accountId,
    )!;
    expect(compte.status).toBe("warmup");
    expect(compte.warmupProtocol?.targetDays).toBe(7);
    expect(compte.warmupProtocol?.dailyChecks.length).toBe(0);

    // ── Le CRÉATEUR le voit « en warmup ». ───────────────────────────────────
    const mine = await A.client.query(api.comptes.listMyComptes, { projectId });
    expect(mine.find((c) => c._id === accountId)?.status).toBe("warmup");

    // ── Historique CONSERVÉ : la publication d'A1 et les 2 assignments restent. ─
    const pubsStill = (
      await admin.query(api.publications.listPublications, {})
    ).filter((p) => p.postUrl === tkUrl);
    expect(pubsStill.length).toBe(1);
    const allAssignments = await admin.query(api.assignments.listAssignments, {});
    expect(allAssignments.some((x) => x._id === a1._id)).toBe(true);
    expect(allAssignments.some((x) => x._id === a2._id)).toBe(true);

    // ── Publication BLOQUÉE : A2 (to_publish en cours) ne peut plus être confirmé. ─
    await expect(
      A.client.mutation(api.assignments.confirmPublication, {
        projectId,
        id: a2._id,
        urls: [{ platform: "TikTok", url: `${tkUrl}b` }],
      }),
    ).rejects.toThrow(/warmup|échauffement/i);

    // ── Et le compte ne peut plus être CIBLÉ par un nouvel assignment. ───────
    await expect(
      admin.mutation(api.assignments.assignFormat, {
        formatId: fmt1,
        creatorId: A.creatorId,
        targets: [target],
        postsPerCreator: 1,
        dueDate: due,
      }),
    ).rejects.toThrow(/warmup/i);
  });
});
