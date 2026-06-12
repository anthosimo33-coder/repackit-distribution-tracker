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
 * Batch G — suppression d'une inspiration via le bouton "Supprimer" du
 * Dialog edit, confirmé via AlertDialog.
 */
test.describe("Inspirations — suppression", () => {
  test.beforeEach(async () => {
    await convex.mutation(api.inspirations.cleanupTestInspirations, { secret: E2E_SECRET });
  });

  test("click card → supprimer → confirm → card disparaît", async ({
    page,
  }) => {
    const titre = `Delete E2E ${Date.now()}`;

    await convex.mutation(api.inspirations.createInspiration, {
      url: "https://www.tiktok.com/@user/video/7000000002",
      type: "video",
      plateforme: "TikTok",
      titre,
      notes: `${E2E_MARKER} to delete`,
    });

    await page.goto("/inspirations");

    await expect(page.getByText(titre).first()).toBeVisible({ timeout: 5000 });

    // Open edit dialog
    await page.getByText(titre).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Click "Supprimer" in footer
    await dialog.getByRole("button", { name: /supprimer/i }).first().click();

    // AlertDialog confirm
    const alert = page.getByRole("alertdialog");
    await expect(alert).toBeVisible();
    await expect(
      alert.getByRole("heading", { name: /supprimer cette inspiration/i }),
    ).toBeVisible();

    // Confirm delete
    await alert.getByRole("button", { name: /^supprimer$/i }).click();

    // Dialog + AlertDialog close, card disappears
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText(titre)).not.toBeVisible({ timeout: 5000 });
  });
});
