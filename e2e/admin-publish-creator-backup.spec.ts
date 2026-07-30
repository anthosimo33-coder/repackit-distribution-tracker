import { test, expect } from "@playwright/test";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

const DAY = 86_400_000;

test.describe("Admin publie EN SECOURS un compte de créatrice", () => {
  test("secours admin : traçabilité, bornes de date, dédup, aucune fuite créatrice", async () => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const fid = await admin.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] Backup ${ts}`,
      type: "short",
      rateModel: { basePerPost: 50 },
    });
    const A = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Backup A ${ts}`,
      email: `e2e-backup-a-${ts}@repackit.test`,
      password: "backup-a-12345",
    });
    // Compte de CRÉATRICE (NON géré) sur TikTok — c'est le cas nouveau.
    const tA = await availableTarget({
      e2eClient: admin,
      creatorId: A.creatorId,
      platform: "TikTok",
      handle: `@e2ebackup${ts}`,
    });
    const r = await admin.mutation(api.assignments.assignFormat, {
      formatId: fid as Id<"formats">,
      creatorId: A.creatorId,
      targets: [tA],
      postsPerCreator: 1,
      dueDate: ts + 7 * DAY,
    });
    expect(r.created).toBe(1);
    const row = (await admin.query(api.assignments.listAssignments, {})).find(
      (a) => a.formatId === fid,
    )!;
    const aid = row._id;

    // PROCESS NON SUIVI : la créatrice a publié hors app, le statut est resté « À
    // faire » (todo, jamais passé to_publish). C'EST le cas d'usage du secours.
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: aid,
      status: "todo",
    });

    const url = `https://www.tiktok.com/@e2ebackup${ts}/video/1`;

    // La créatrice, elle, ne peut PAS publier depuis « À faire » : gate to_publish
    // CONSERVÉ côté créatrice (seul l'admin en secours le court-circuite).
    await expect(
      A.client.mutation(api.assignments.confirmPublication, {
        projectId: A.projectId,
        id: aid,
        urls: [{ platform: "TikTok", url }],
      }),
    ).rejects.toThrow(/validation/i);

    // BORNES de la date réelle : futur REJETÉ, antérieur à la création REJETÉ.
    await expect(
      admin.mutation(api.assignments.confirmPublicationAsAdmin, {
        id: aid,
        urls: [{ platform: "TikTok", url }],
        publishedAt: ts + DAY,
      }),
    ).rejects.toThrow(/futur/i);
    await expect(
      admin.mutation(api.assignments.confirmPublicationAsAdmin, {
        id: aid,
        urls: [{ platform: "TikTok", url }],
        publishedAt: row.createdAt - DAY,
      }),
    ).rejects.toThrow(/précéder la création/i);

    // SECOURS : l'admin publie une assignation restée « À faire » (fromAnyStatus)
    // → passage DIRECT en publiée. Sans override → date = maintenant.
    const pub = await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
      id: aid,
      urls: [{ platform: "TikTok", url }],
    });
    expect(pub.alreadyPublished).toBe(false);

    // Traçabilité ADMIN visible côté admin.
    const after = (await admin.query(api.assignments.listAssignments, {})).find(
      (a) => a._id === aid,
    )!;
    expect(after.status).toBe("published");
    expect((after as Record<string, unknown>).publishedBy).toBe("admin");

    // CÔTÉ CRÉATRICE : publié, MAIS `publishedBy` JAMAIS exposé (elle ne doit pas
    // voir que l'admin a saisi le lien à sa place).
    const mine = await A.client.query(api.assignments.getMyAssignment, {
      projectId: A.projectId,
      id: aid,
    });
    expect(mine?.assignment.status).toBe("published");
    expect(
      (mine!.assignment as Record<string, unknown>).publishedBy,
    ).toBeUndefined();

    // DOUBLON : la créatrice colle SON lien après coup → idempotent, aucune 2e
    // publication, et l'auteur d'origine (admin) n'est PAS réécrit.
    const again = await A.client.mutation(api.assignments.confirmPublication, {
      projectId: A.projectId,
      id: aid,
      urls: [
        { platform: "TikTok", url: `https://www.tiktok.com/@e2ebackup${ts}/video/999` },
      ],
    });
    expect(again.alreadyPublished).toBe(true);
    const stillAdmin = (
      await admin.query(api.assignments.listAssignments, {})
    ).find((a) => a._id === aid)!;
    expect((stillAdmin as Record<string, unknown>).publishedBy).toBe("admin");

    // Cleanup
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: aid,
      status: "todo",
    });
  });
});
