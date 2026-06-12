import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

const E2E_MARKER = "[E2E_TEST]";

/**
 * CRUD ICPs via /comptes?view=icps. Couvre EmptyState → créer (nom +
 * description + couleur) → shortsCount 0 → renommer → changer couleur →
 * supprimer via AlertDialog. Les ICPs de test sont marqués via le nom
 * préfixé [E2E_TEST] (cleanupTestIcps).
 */
test.describe("ICPs — CRUD", () => {
  test.beforeEach(async () => {
    await convex.mutation(api.icps.cleanupTestIcps, { secret: E2E_SECRET });
  });

  test("create → rename → change-color → delete ICP", async ({ page }) => {
    const ts = Date.now();
    const nom = `${E2E_MARKER} Mid-tier FR ${ts}`;
    const renamed = `${E2E_MARKER} Mid-tier US ${ts}`;

    await page.goto(adminPath("/comptes?view=icps"));

    await expect(page.getByRole("heading", { name: /^icps$/i })).toBeVisible();
    await expect(
      page.getByText(/crée ton premier icp/i),
    ).toBeVisible();

    // Créer
    await page.getByRole("button", { name: /nouvel icp/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Nom *", { exact: true }).fill(nom);
    await dialog.getByLabel(/description/i).fill(`${E2E_MARKER} desc`);
    await dialog.getByRole("button", { name: /couleur amber/i }).click();
    await dialog.getByRole("button", { name: /^enregistrer$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Apparaît avec shortsCount 0
    const row = page.locator("ul > li").filter({ hasText: nom });
    await expect(row).toBeVisible({ timeout: 5000 });
    await expect(row.getByText(/0 short/i)).toBeVisible();

    // Renommer
    await row.getByRole("button", { name: /renommer/i }).click();
    const editDialog = page.getByRole("dialog");
    await expect(editDialog).toBeVisible();
    await editDialog.getByLabel("Nom *", { exact: true }).fill(renamed);
    await editDialog.getByRole("button", { name: /^enregistrer$/i }).click();
    await expect(editDialog).not.toBeVisible({ timeout: 5000 });
    const renamedRow = page.locator("ul > li").filter({ hasText: renamed });
    await expect(renamedRow).toBeVisible({ timeout: 5000 });

    // Changer la couleur via le popover Palette → Emerald
    await renamedRow
      .getByRole("button", { name: /changer la couleur/i })
      .click();
    await page.getByRole("button", { name: /couleur emerald/i }).click();
    await expect(
      page.getByText(/couleur mise à jour/i).first(),
    ).toBeVisible({ timeout: 5000 });

    // Supprimer via AlertDialog
    await renamedRow.getByRole("button", { name: /supprimer/i }).click();
    const alert = page.getByRole("alertdialog");
    await expect(alert).toBeVisible();
    await alert.getByRole("button", { name: /^supprimer$/i }).click();
    await expect(alert).not.toBeVisible({ timeout: 5000 });
    await expect(
      page.locator("ul > li").filter({ hasText: renamed }),
    ).not.toBeVisible();
  });
});
