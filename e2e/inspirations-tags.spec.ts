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
 * Batch H — TagsInput avec chips removable + autocomplete + dedupe.
 *
 * Couvre :
 *   - Add via Enter → chip
 *   - Add majuscules → dedupliqué case-insensitive (lowercase auto)
 *   - Remove via X → chip removed
 *   - Backspace sur input vide → retire dernier chip
 *   - Persistence après save + reload
 */
test.describe("Inspirations — TagsInput", () => {
  test.beforeEach(async () => {
    await convex.mutation(api.inspirations.cleanupTestInspirations, { secret: E2E_SECRET });
  });

  test("add Enter + dedupe + X remove + persistence", async ({ page }) => {
    const titre = `Tags E2E ${Date.now()}`;
    await convex.mutation(api.inspirations.createInspiration, {
      url: "https://www.tiktok.com/@user/video/7000000400",
      type: "video",
      plateforme: "TikTok",
      titre,
      notes: `${E2E_MARKER} tags test`,
    });

    await page.goto(adminPath("/inspirations"));
    await expect(page.getByText(titre).first()).toBeVisible({ timeout: 5000 });

    // Ouvrir Dialog edit
    await page.getByText(titre).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const tagsInput = dialog.getByLabel(/ajouter un tag/i);

    // Add "growth" + Enter
    await tagsInput.fill("growth");
    await tagsInput.press("Enter");
    await expect(dialog.getByText("growth", { exact: true })).toBeVisible();

    // Add "GROWTH" → dedupe (no second chip)
    await tagsInput.fill("GROWTH");
    await tagsInput.press("Enter");
    // Toujours un seul chip "growth"
    expect(
      await dialog.getByText("growth", { exact: true }).count(),
    ).toBe(1);

    // Add "b2b" via virgule. pressSequentially dispatch les keydown réels
    // (fill() ne déclenche que le change event, pas le keydown sur ',').
    await tagsInput.pressSequentially("b2b,");
    await expect(dialog.getByText("b2b", { exact: true })).toBeVisible();

    // Remove "growth" via X
    await dialog
      .getByRole("button", { name: /retirer le tag growth/i })
      .click();
    await expect(dialog.getByText("growth", { exact: true })).not.toBeVisible();

    // Backspace sur input vide → retire "b2b" (dernier chip)
    await tagsInput.focus();
    await tagsInput.press("Backspace");
    await expect(dialog.getByText("b2b", { exact: true })).not.toBeVisible();

    // Re-add un tag avant save
    await tagsInput.fill("persist");
    await tagsInput.press("Enter");

    // Save
    await dialog.getByRole("button", { name: /^sauvegarder$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Reload → re-open Dialog edit → tag présent
    await page.reload();
    await expect(page.getByText(titre).first()).toBeVisible({ timeout: 5000 });
    await page.getByText(titre).first().click();
    const dialog2 = page.getByRole("dialog");
    await expect(dialog2).toBeVisible();
    await expect(dialog2.getByText("persist", { exact: true })).toBeVisible({
      timeout: 5000,
    });
  });
});
