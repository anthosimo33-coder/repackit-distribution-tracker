import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

const E2E_MARKER = "[E2E_TEST]";

/**
 * Batch G — CRUD folders via ?view=folders.
 *
 * Couvre :
 *   - EmptyState si zéro folder (après cleanup)
 *   - Créer folder via dialog (nom + description + color picker)
 *   - Folder apparaît avec count 0
 *   - Renommer via dialog edit
 *   - Supprimer via AlertDialog confirm
 */
test.describe("Folders — CRUD", () => {
  test.beforeEach(async () => {
    await convex.mutation(api.folders.cleanupTestFolders, { secret: E2E_SECRET });
  });

  test("create → rename → delete folder", async ({ page }) => {
    const name = `Folder E2E ${Date.now()}`;
    const renamed = `${name} renommé`;
    const description = `${E2E_MARKER} test folder`;

    await page.goto("/inspirations?view=folders");

    // Header "Dossiers" visible
    await expect(
      page.getByRole("heading", { name: /^dossiers$/i }),
    ).toBeVisible();

    // Click "+ Nouveau dossier"
    await page
      .getByRole("button", { name: /nouveau dossier/i })
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Fill name + description
    await dialog.getByLabel(/nom \*/i).fill(name);
    await dialog.getByLabel(/description/i).fill(description);

    // Pick color "amber" (3rd in the palette)
    await dialog.getByRole("button", { name: /couleur amber/i }).click();

    // Submit
    await dialog.getByRole("button", { name: /^créer$/i }).click();

    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Folder appears in list with count 0
    const row = page.locator("ul > li").filter({ hasText: name });
    await expect(row).toBeVisible({ timeout: 5000 });
    await expect(row.getByText("0").first()).toBeVisible();

    // Rename: click pencil icon button
    await row.getByRole("button", { name: new RegExp(`renommer ${name}`, "i") }).click();
    const editDialog = page.getByRole("dialog");
    await expect(editDialog).toBeVisible();
    await editDialog.getByLabel(/nom \*/i).fill(renamed);
    await editDialog.getByRole("button", { name: /^sauvegarder$/i }).click();

    await expect(editDialog).not.toBeVisible({ timeout: 5000 });
    await expect(
      page.locator("ul > li").filter({ hasText: renamed }),
    ).toBeVisible({ timeout: 5000 });

    // Delete: click trash icon
    const renamedRow = page.locator("ul > li").filter({ hasText: renamed });
    await renamedRow
      .getByRole("button", { name: new RegExp(`supprimer ${renamed}`, "i") })
      .click();

    const alert = page.getByRole("alertdialog");
    await expect(alert).toBeVisible();
    await alert.getByRole("button", { name: /^supprimer$/i }).click();

    await expect(alert).not.toBeVisible({ timeout: 5000 });
    await expect(
      page.locator("ul > li").filter({ hasText: renamed }),
    ).not.toBeVisible();
  });
});
