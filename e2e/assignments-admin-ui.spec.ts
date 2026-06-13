import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * P7 — geste admin : assignation en masse via le modal (depuis un format), et
 * mise en évidence des assignments en retard dans la table /admin/.../assignments.
 */
test.describe("Admin — assignation + table", () => {
  test("modal d'assignation crée N rows + l'en-retard ressort", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const creatorName = `[E2E_TEST] AssignUI ${ts}`;
    const C = await createCreatorSession(convexUrl, {
      name: creatorName,
      email: `e2e-creator-asgui-${ts}@repackit.test`,
      password: "creator-asgui-12345",
    });
    const formatName = `[E2E_TEST] AssignUI Fmt ${ts}`;
    const fid = (await admin.mutation(api.formats.createFormat, {
      name: formatName,
      type: "short",
      rateModel: { basePerPost: 30 },
    })) as Id<"formats">;

    // 1 assignment EN RETARD posé côté serveur (dueDate passée).
    await admin.mutation(api.assignments.assignFormat, {
      formatId: fid,
      creatorIds: [C.creatorId],
      postsPerCreator: 1,
      dueDate: ts - 3 * 86_400_000,
    });

    // Modal d'assignation depuis la fiche format : 2 posts.
    await page.goto(adminPath(`/formats/${fid}`));
    await page.getByRole("button", { name: /^assigner$/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByText(creatorName).click(); // coche le créateur
    await dialog.getByLabel("Posts par créateur").fill("2");
    await dialog.getByRole("button", { name: "Assigner", exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 8000 });

    // Serveur : 1 (retard) + 2 (modal) = 3 rows pour ce format.
    const list = await admin.query(api.assignments.listAssignments, {});
    expect(list.filter((a) => a.formatId === fid).length).toBe(3);

    // Table admin : 3 lignes pour ce format, dont une en retard.
    await page.goto(adminPath("/assignments"));
    const rowsForFormat = page.getByRole("row").filter({ hasText: formatName });
    await expect(rowsForFormat).toHaveCount(3, { timeout: 10_000 });
    await expect(page.getByText("(retard)").first()).toBeVisible();

    // « En retard seulement » → ne reste que la ligne en retard.
    await page
      .getByText("En retard seulement")
      .click();
    await expect(rowsForFormat).toHaveCount(1, { timeout: 8000 });

    // Cleanup (cleanupTestAssignments nettoie aussi, mais on évite l'accumulation).
    for (const a of list.filter((x) => x.formatId === fid)) {
      await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
        secret: process.env.E2E_SECRET ?? "",
        id: a._id,
        status: "todo",
      });
    }
  });
});
