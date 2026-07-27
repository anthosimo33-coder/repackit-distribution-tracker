import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * P7 — geste admin : mise en évidence des assignments en retard dans la table
 * /admin/.../assignments + filtre « en retard seulement ». L'assignation en
 * masse est posée côté serveur (le modal AssignFormatDialog, lancé depuis la
 * fiche format, a été retiré avec la page Formats).
 */
test.describe("Admin — assignation + table", () => {
  test("assignation crée N rows + l'en-retard ressort dans la table", async ({
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

    // Compte TikTok DISPONIBLE (cible) + 1 assignment EN RETARD côté serveur.
    const tkHandle = `@e2easgui${ts}`;
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: C.creatorId,
      platform: "TikTok",
      handle: tkHandle,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId: fid,
      creatorId: C.creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts - 3 * 86_400_000,
    });

    // Assignation en masse (2 vidéos) posée côté serveur — équivalent du modal
    // AssignFormatDialog retiré avec la page Formats (api.assignments.assignFormat).
    // Total attendu pour ce format : 1 (retard) + 2 = 3.
    await admin.mutation(api.assignments.assignFormat, {
      formatId: fid,
      creatorId: C.creatorId,
      targets: [target],
      postsPerCreator: 2,
      dueDate: ts + 7 * 86_400_000,
    });

    // Serveur : 1 (retard) + 2 (modal) = 3 rows pour ce format. Même course de
    // propagation cross-client que pour la suppression → poll au lieu d'un
    // one-shot. Strict : un total ≠ 3 au-delà du timeout fait échouer le test.
    await expect
      .poll(
        async () =>
          (await admin.query(api.assignments.listAssignments, {})).filter(
            (a) => a.formatId === fid,
          ).length,
        { timeout: 10_000 },
      )
      .toBe(3);
    const list = await admin.query(api.assignments.listAssignments, {});

    // Table admin : 3 lignes pour ce format, dont une en retard.
    await page.goto(adminPath("/assignments"));
    // La vue par DÉFAUT est le calendrier → basculer en Liste pour la table.
    await page.getByRole("radio", { name: "Liste" }).click();
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

  test("supprimer un assignment depuis la table (confirmation → disparaît)", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const creatorName = `[E2E_TEST] DelUI ${ts}`;
    const C = await createCreatorSession(convexUrl, {
      name: creatorName,
      email: `e2e-creator-delui-${ts}@repackit.test`,
      password: "creator-delui-12345",
    });
    const formatName = `[E2E_TEST] DelUI Fmt ${ts}`;
    const fid = (await admin.mutation(api.formats.createFormat, {
      name: formatName,
      type: "short",
      rateModel: { basePerPost: 30 },
    })) as Id<"formats">;
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: C.creatorId,
      platform: "TikTok",
      handle: `@e2edelui${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId: fid,
      creatorId: C.creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 7 * 86_400_000,
    });

    await page.goto(adminPath("/assignments"));
    // La vue par DÉFAUT est le calendrier → basculer en Liste pour la table.
    await page.getByRole("radio", { name: "Liste" }).click();
    const row = page.getByRole("row").filter({ hasText: formatName });
    await expect(row).toHaveCount(1, { timeout: 10_000 });

    // Poubelle → AlertDialog de confirmation → Supprimer.
    await row.getByRole("button", { name: "Supprimer cet assignment" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/irréversible/i);
    await dialog.getByRole("button", { name: "Supprimer" }).click();

    // La ligne disparaît (réactivité Convex) ; le serveur confirme la suppression.
    await expect(row).toHaveCount(0, { timeout: 10_000 });
    // La propagation de la suppression vers la query re-fetchée (client admin
    // distinct de la page) peut avoir un micro-retard sous charge : on POLLE
    // jusqu'à ce que l'assignment ait disparu côté serveur, au lieu d'un check
    // one-shot qui flake. Reste STRICT : si l'assignment n'est réellement pas
    // supprimé, le poll renvoie true jusqu'au timeout et l'assertion échoue.
    await expect
      .poll(
        async () => {
          const list = await admin.query(api.assignments.listAssignments, {});
          return list.some((a) => a.formatId === fid);
        },
        { timeout: 10_000 },
      )
      .toBe(false);
  });
});
