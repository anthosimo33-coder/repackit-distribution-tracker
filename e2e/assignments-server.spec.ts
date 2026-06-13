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
  test("assignation en masse, isolation, soumission, garde resoumission", async () => {
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

    // Flux : todo → in_progress → submitted (URL TikTok).
    const aid = aList[0]._id;
    await expect(
      A.client.mutation(api.assignments.submitAssignment, {
        projectId: A.projectId,
        id: aid,
        url: "https://www.tiktok.com/@x/video/1",
      }),
    ).rejects.toThrow(/impossible|resoumission/i); // pas encore démarré (todo)

    await A.client.mutation(api.assignments.startAssignment, {
      projectId: A.projectId,
      id: aid,
    });
    await A.client.mutation(api.assignments.submitAssignment, {
      projectId: A.projectId,
      id: aid,
      url: "https://www.tiktok.com/@moi/video/123",
    });
    const afterSubmit = await A.client.query(api.assignments.getMyAssignment, {
      projectId: A.projectId,
      id: aid,
    });
    expect(afterSubmit?.assignment.status).toBe("submitted");
    expect(afterSubmit?.assignment.submittedPlatform).toBe("TikTok");

    // Garde : resoumettre quand "submitted" → refusé.
    await expect(
      A.client.mutation(api.assignments.submitAssignment, {
        projectId: A.projectId,
        id: aid,
        url: "https://www.tiktok.com/@moi/video/456",
      }),
    ).rejects.toThrow(/resoumission|impossible/i);

    // Forcer "rejected" (helper e2e) → resoumission AUTORISÉE.
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: aid,
      status: "rejected",
      adminFeedback: "Refais le hook",
    });
    await A.client.mutation(api.assignments.submitAssignment, {
      projectId: A.projectId,
      id: aid,
      url: "https://www.tiktok.com/@moi/video/789",
    });
    const afterResubmit = await A.client.query(api.assignments.getMyAssignment, {
      projectId: A.projectId,
      id: aid,
    });
    expect(afterResubmit?.assignment.status).toBe("submitted");

    // Admin voit les 4 (dont le soumis).
    const adminList = await admin.query(api.assignments.listAssignments, {});
    const mine = adminList.filter((a) => a.formatId === fid);
    expect(mine.length).toBe(4);
    expect(mine.some((a) => a.status === "submitted")).toBe(true);

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
