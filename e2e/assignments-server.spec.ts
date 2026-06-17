import { test, expect } from "@playwright/test";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

const RATE = {
  basePerPost: 50,
  viewBonusPer1k: 2,
  bounties: [{ thresholdViews: 100_000, amount: 100 }],
};

test.describe("Assignments — serveur (isolation + flux)", () => {
  test("assignation en masse, isolation, publication, idempotence", async () => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const fid = await admin.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] Assign ${ts}`,
      type: "short",
      rateModel: RATE,
    });
    const A = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Assignee A ${ts}`,
      email: `e2e-creator-asgA-${ts}@repackit.test`,
      password: "creator-asgA-12345",
    });
    const B = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Assignee B ${ts}`,
      email: `e2e-creator-asgB-${ts}@repackit.test`,
      password: "creator-asgB-12345",
    });
    const due = ts + 7 * 86_400_000;

    // Assignation en masse : 2 créateurs × 2 posts = 4 rows.
    const { created } = await admin.mutation(api.assignments.assignFormat, {
      formatId: fid as Id<"formats">,
      creatorIds: [A.creatorId, B.creatorId],
      postsPerCreator: 2,
      dueDate: due,
    });
    expect(created).toBe(4);

    // Chaque créateur voit SES 2 assignments, et SEULEMENT les siens.
    const aList = await A.client.query(api.assignments.listMyAssignments, {
      projectId: A.projectId,
    });
    const bList = await B.client.query(api.assignments.listMyAssignments, {
      projectId: B.projectId,
    });
    expect(aList.length).toBe(2);
    expect(bList.length).toBe(2);
    expect(aList.every((a) => a.creatorId === A.creatorId)).toBe(true);
    // ISOLATION : aucun assignment de B chez A.
    const bIds = new Set(bList.map((a) => a._id));
    expect(aList.some((a) => bIds.has(a._id))).toBe(false);

    // getMyAssignment d'un assignment de B, demandé par A → null (isolé).
    const crossRead = await A.client.query(api.assignments.getMyAssignment, {
      projectId: A.projectId,
      id: bList[0]._id,
    });
    expect(crossRead).toBeNull();

    // rateSnapshot figé : présent sur l'assignment de A.
    const own = await A.client.query(api.assignments.getMyAssignment, {
      projectId: A.projectId,
      id: aList[0]._id,
    });
    expect(own?.assignment.rateSnapshot.basePerPost).toBe(50);
    expect(own?.format?.name).toContain("[E2E_TEST] Assign");

    // Flux machine MP4 : confirmPublication n'est possible qu'en to_publish.
    const aid = aList[0]._id;
    await expect(
      A.client.mutation(api.assignments.confirmPublication, {
        projectId: A.projectId,
        id: aid,
        url: "https://www.tiktok.com/@x/video/1",
      }),
    ).rejects.toThrow(/validation|publication|impossible/i); // pas en to_publish

    // Vidéo validée (on saute l'upload) → to_publish, puis le créateur PUBLIE.
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: aid,
      status: "to_publish",
    });
    const published = await A.client.mutation(
      api.assignments.confirmPublication,
      { projectId: A.projectId, id: aid, url: "https://www.tiktok.com/@moi/video/123" },
    );
    expect(published.alreadyPublished).toBe(false);
    const afterPublish = await A.client.query(api.assignments.getMyAssignment, {
      projectId: A.projectId,
      id: aid,
    });
    expect(afterPublish?.assignment.status).toBe("published");
    expect(afterPublish?.assignment.submittedPlatform).toBe("TikTok");

    // Re-confirmer une publication = IDEMPOTENT (no-op), pas une erreur.
    const again = await A.client.mutation(api.assignments.confirmPublication, {
      projectId: A.projectId,
      id: aid,
      url: "https://www.tiktok.com/@moi/video/456",
    });
    expect(again.alreadyPublished).toBe(true);

    // Admin voit les 4 (dont le publié).
    const adminList = await admin.query(api.assignments.listAssignments, {});
    const mine = adminList.filter((a) => a.formatId === fid);
    expect(mine.length).toBe(4);
    expect(mine.some((a) => a.status === "published")).toBe(true);

    // Cleanup
    for (const a of mine) {
      await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
        secret: E2E_SECRET,
        id: a._id,
        status: "todo",
      });
    }
  });

  test("guide : lecture créateur OK, édition réservée à l'admin", async () => {
    const ts = Date.now();
    const C = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Guide reader ${ts}`,
      email: `e2e-creator-guide-${ts}@repackit.test`,
      password: "creator-guide-12345",
    });

    // L'admin édite le guide.
    const content = `# Guide test ${ts}\nComment je suis payé : à l'unité.`;
    await admin.mutation(api.guide.updateProjectGuide, { content });

    // Le créateur le lit (creatorQuery, isolé projet).
    const seen = await C.client.query(api.guide.getMyGuide, {
      projectId: C.projectId,
    });
    expect(seen.content).toContain(`Guide test ${ts}`);

    // Le créateur NE PEUT PAS l'éditer (adminMutation).
    await expect(
      C.client.mutation(api.guide.updateProjectGuide, {
        projectId: C.projectId,
        content: "hack créateur",
      }),
    ).rejects.toThrow(/administrateur|refusé/i);
  });
});
